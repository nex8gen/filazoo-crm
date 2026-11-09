import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import type { WorkspaceViewer } from "../auth.ts";
import { leadMutationSchema, leadSearchSchema, leadProfileRequestSchema, type LeadProduct, type LeadResult, type LeadSearch, type LeadSearchInput } from "../ai-leads.ts";
import { buyerProfileSchema, legacyQualification, type BuyerProfile } from "../lead-prospecting.ts";
import { generateBuyerProfile } from "../ai/lead-buyer-profile.ts";
import { withPersonalProducts } from "./product-personalization.ts";
import { createLeadAiCall, discoverLeads } from "../ai/lead-discovery.ts";
import { requireAiFeature } from "./ai-settings.ts";
import { isQualifiedLead, leadCompanyExclusions, type LeadCompanyIdentity, type LeadResearchSummary } from "../lead-discovery-policy.ts";
import { leadDomain } from "../ai-leads.ts";

export class LeadError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
type SearchRow = { id: string; context_key: string; status: LeadSearch["status"]; phase: string; criteria: LeadSearchInput; products: LeadProduct[]; results: LeadResult[]; research_summary?: LeadResearchSummary | null; error: string | null; created_at: string; updated_at: string };
const selection = "id,context_key,status,phase,criteria,products,results,research_summary,error,created_at,updated_at";
const mapSearch = (row: SearchRow): LeadSearch => ({ id: row.id, status: row.status, phase: row.phase, criteria: row.criteria, products: row.products, results: row.results.map(lead=>({...lead,qualification:legacyQualification(lead),...(!lead.matchedProducts.length||!lead.fitEvidence ? {fitScore:Math.min(49,lead.fitScore),confidence:"needs_review" as const,fitEvidence:null} : {})})), researchSummary: row.research_summary, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at });
const writer = (viewer: WorkspaceViewer) => { if (viewer.role === "viewer") throw new LeadError("Your role can view searches. Ask a workspace operator to run or save leads.", 403); };
function databaseError(error: { code?: string }) {
  return new LeadError(["42P01","PGRST205","PGRST202","42883"].includes(error.code ?? "") ? "AI Leads database setup is missing. Apply the AI lead discovery migration." : "Lead records could not be loaded or saved. Please try again.", 503);
}

export async function leadProductOptions(viewer: WorkspaceViewer) {
  return withWorkspaceViewer(viewer, async () => {
    const { data, error } = await createSupabaseAdmin().from("products").select("sku,name,description,material,diameter,weight,moq,active").order("name").limit(500);
    if (error) throw databaseError(error);
    return (await withPersonalProducts(data ?? [], viewer.id)).filter(row=>row.active!==false&&!row.sku.startsWith("SAMPLE-")&&!row.name.toLowerCase().startsWith("[sample]")).map(row => ({ sku: row.sku, name: row.name, description: [row.description,row.material,row.diameter,row.weight].filter(Boolean).join(" · ").slice(0,1500), moq: row.moq })) as LeadProduct[];
  });
}

async function expireInterrupted() {
  const { error } = await createSupabaseAdmin().from("ai_lead_searches").update({ status: "failed", phase: "Interrupted", error: "This search was interrupted. Start a new search to retry; no paid call was automatically repeated.", updated_at: new Date().toISOString() }).in("status",["queued","running"]).lt("updated_at",new Date(Date.now()-240000).toISOString());
  if (error) throw databaseError(error);
}
export async function listLeadSearches(viewer: WorkspaceViewer): Promise<LeadSearch[]> {
  return withWorkspaceViewer(viewer, async () => {
    await expireInterrupted();
    const { data, error } = await createSupabaseAdmin().from("ai_lead_searches").select(selection).order("created_at",{ ascending:false }).limit(20);
    if (error) throw databaseError(error);
    const rows = data as SearchRow[];
    if (!rows.length) return [];
    const feedback = await createSupabaseAdmin().from("ai_lead_feedback").select("context_key,domain,reason").in("context_key",[...new Set(rows.map(row=>row.context_key))]);
    if (feedback.error) throw databaseError(feedback.error);
    return rows.map(row=>{const search=mapSearch(row);search.results=search.results.map(lead=>({...lead,feedback:feedback.data?.find(item=>item.context_key===row.context_key&&item.domain===lead.domain)?.reason as LeadResult["feedback"]}));return search;});
  });
}

async function selectedLeadProducts(viewer: WorkspaceViewer, input: {productSkus:string[];customProduct?:{name:string;description:string}}, businessContext:string) {
  const catalog=await leadProductOptions(viewer);
  const skus=[...new Set(input.productSkus)];
  const siblings=catalog.slice(0,40).map(product=>product.name.slice(0,100));
  const products=catalog.filter(product=>skus.includes(product.sku)).map(product=>({...product,catalogContext:siblings,businessContext}));
  if(products.length!==skus.length)throw new LeadError("A selected product is unavailable in this workspace. Refresh the catalog.");
  if(input.customProduct)products.push({sku:"custom-product",name:input.customProduct.name,description:input.customProduct.description,moq:null,catalogContext:[],businessContext:""});
  return products;
}
function profileContextKey(products:LeadProduct[], productContext="") {
  return createHash("sha256").update(JSON.stringify({version:2,products:[...products].sort((a,b)=>a.sku.localeCompare(b.sku)),productContext})).digest("hex");
}

export async function prepareLeadProfile(viewer:WorkspaceViewer,value:unknown):Promise<BuyerProfile> {
  writer(viewer);
  const parsed=leadProfileRequestSchema.safeParse(value);
  if(!parsed.success)throw new LeadError(parsed.error.issues[0]?.message||"Choose valid products.");
  return withWorkspaceViewer(viewer,async()=>{
    const policy=await requireAiFeature("webSearch","products");
    const products=await selectedLeadProducts(viewer,parsed.data,policy.businessContext);
    const contextKey=profileContextKey(products,parsed.data.productContext);
    const db=createSupabaseAdmin(),now=()=>new Date().toISOString();
    const previous=await db.from("ai_lead_buyer_profiles").select("id,status,profile,updated_at").eq("context_key",contextKey).maybeSingle();
    if(previous.error)throw databaseError(previous.error);
    if(previous.data?.status==="complete")return{...buyerProfileSchema.parse(previous.data.profile),id:previous.data.id};
    if(previous.data?.status==="running") {
      if(Date.parse(previous.data.updated_at)<Date.now()-90000) {
        await db.from("ai_lead_buyer_profiles").update({status:"failed",error:"Profile preparation was interrupted.",updated_at:now()}).eq("id",previous.data.id).eq("status","running");
        throw new LeadError("Profile preparation was interrupted. Click prepare again to retry.",409);
      }
      throw new LeadError("These products are already being analyzed. Try again in a moment.",409);
    }
    const claim=previous.data
      ? await db.from("ai_lead_buyer_profiles").update({status:"running",error:null,updated_at:now()}).eq("id",previous.data.id).eq("status","failed").select("id").maybeSingle()
      : await db.from("ai_lead_buyer_profiles").insert({context_key:contextKey,created_by:viewer.id}).select("id").single();
    if(claim.error?.code==="23505"||!claim.data&&!claim.error)throw new LeadError("These products are already being analyzed. Try again in a moment.",409);
    if(claim.error||!claim.data)throw databaseError(claim.error??{});
    try {
      const profile=await generateBuyerProfile(products,parsed.data.productContext,await createLeadAiCall(viewer.id,{maximumCalls:1,limitMicros:20000}),AbortSignal.timeout(40000));
      const saved=await db.from("ai_lead_buyer_profiles").update({status:"complete",profile,updated_at:now()}).eq("id",claim.data.id);
      if(saved.error)throw databaseError(saved.error);
      return{...profile,id:claim.data.id};
    }catch(error) {
      console.error("Buyer profile preparation failed", {name:error instanceof Error ? error.name : "Unknown",message:error instanceof Error ? error.message.slice(0,1200) : "Unknown error"});
      await db.from("ai_lead_buyer_profiles").update({status:"failed",error:"Buyer profile could not be prepared.",updated_at:now()}).eq("id",claim.data.id);
      throw new LeadError(error instanceof Error&&error.name==="AiBudgetError" ? error.message : "Buyer profile could not be prepared. Add a clear product description and try again.",503);
    }
  });
}

export async function startLeadSearch(viewer: WorkspaceViewer, value: unknown) {
  writer(viewer);
  const parsed = leadSearchSchema.safeParse(value);
  if (!parsed.success) throw new LeadError(parsed.error.issues[0]?.message ?? "Check the search fields.");
  return withWorkspaceViewer(viewer, async () => {
    const input = parsed.data, db = createSupabaseAdmin();
    const previous = await db.from("ai_lead_searches").select(selection).eq("request_id",input.requestId).maybeSingle();
    if (previous.error) throw databaseError(previous.error);
    if (previous.data) return { search: mapSearch(previous.data as SearchRow), created: false };
    let policy;
    try { policy = await requireAiFeature("webSearch","products"); }
    catch(error) { throw new LeadError(error instanceof Error ? error.message : "Workspace AI research is disabled.",403); }
    await expireInterrupted();
    const products=await selectedLeadProducts(viewer,input,policy.businessContext);
    if(!input.profileId)throw new LeadError("Prepare and review a buyer profile before finding companies.");
    const profileRow=await db.from("ai_lead_buyer_profiles").select("context_key,status,profile").eq("id",input.profileId).maybeSingle();
    if(profileRow.error)throw databaseError(profileRow.error);
    if(!profileRow.data||profileRow.data.status!=="complete"||profileRow.data.context_key!==profileContextKey(products,input.productContext))throw new LeadError("The buyer profile does not match these workspace products. Prepare it again.");
    const profile=buyerProfileSchema.parse(profileRow.data.profile);
    const segments=profile.segments.filter(segment=>input.segmentIds?.includes(segment.id));
    if(!segments.length)throw new LeadError("Select at least one buyer group.");
    const category=input.categoryOverride?.trim()||profile.category;
    const definition=input.definitionOverride?.trim()||profile.definition;
    if(category.length<3||definition.length<10)throw new LeadError("Confirm a clear product category and description.");
    if(profile.clarity==="needs_clarification"&&category===profile.category&&definition===profile.definition)throw new LeadError("Clarify the product category and definition before searching.");
    input.audience={category,definition,segments,contactRoles:profile.contactRoles};
    input.buyerTypes=segments.map(segment=>segment.label).join(", ");
    const contextKey = createHash("sha256").update(JSON.stringify({ products: [...products].sort((a,b)=>a.sku.localeCompare(b.sku)), productContext:input.productContext,country:input.country.toLowerCase(), city:input.city.toLowerCase(), buyerTypes:input.buyerTypes, requirements:input.requirements, exclusions:input.exclusions })).digest("hex");
    const feedback = await db.from("ai_lead_feedback").select("domain,reason").eq("context_key",contextKey).order("updated_at",{ascending:false}).limit(30);
    if (feedback.error) throw databaseError(feedback.error);
    const { data, error } = await db.from("ai_lead_searches").insert({ request_id:input.requestId,created_by:viewer.id,criteria:input,products,context_key:contextKey,feedback_context:feedback.data ?? [] }).select(selection).single();
    if (error?.code === "23505") throw new LeadError("A search is already running in this workspace. Wait for it or cancel it before starting another.",409);
    if (error || !data) throw databaseError(error ?? {});
    return { search:mapSearch(data as SearchRow),created:true };
  });
}

// Page through all identities. The UI's 20-search history and the REST row
// limit must never become a limit on duplicate protection.
async function leadCrmIdentities(): Promise<LeadCompanyIdentity[]> {
  const db = createSupabaseAdmin(), identities: LeadCompanyIdentity[] = [];
  for (let offset = 0; ; offset += 500) {
    const {data,error} = await db.from("companies").select("name,domain,website").order("id").range(offset,offset+499);
    if (error) throw databaseError(error);
    identities.push(...(data ?? []).map(company => ({name:company.name ?? "",domain:company.domain,website:company.website})));
    if (!data || data.length < 500) return identities;
  }
}
async function leadHistoryIdentities(searchId: string): Promise<LeadCompanyIdentity[]> {
  const db = createSupabaseAdmin(), identities: LeadCompanyIdentity[] = [];
  for (let offset = 0; ; offset += 500) {
    const {data,error} = await db.from("ai_lead_company_history").select("domain,company_name").neq("search_id",searchId).order("domain").range(offset,offset+499);
    if (error) throw databaseError(error);
    identities.push(...(data ?? []).map(company => ({name:company.company_name,domain:company.domain})));
    if (!data || data.length < 500) return identities;
  }
}

export async function runLeadSearch(viewer: WorkspaceViewer, id: string) {
  return withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin(), now = () => new Date().toISOString();
    const claim = await db.from("ai_lead_searches").update({status:"running",phase:"Starting research",updated_at:now()}).eq("id",id).eq("status","queued").select("criteria,products,feedback_context,context_key").maybeSingle();
    if (claim.error || !claim.data) return;
    const signal = AbortSignal.timeout(150000);
    try {
      await requireAiFeature("webSearch","products");
      const [crmCompanies, previousCompanies, attempts] = await Promise.all([
        leadCrmIdentities(), leadHistoryIdentities(id),
        db.from("ai_lead_searches").select("id", { count: "exact", head: true }).eq("context_key", claim.data.context_key).neq("id", id),
      ]);
      if (attempts.error) throw databaseError(attempts.error);
      const call = await createLeadAiCall(viewer.id);
      let researchSummary: LeadResearchSummary | null = null;
      const results = await discoverLeads({ input:claim.data.criteria,products:claim.data.products,feedback:claim.data.feedback_context,excludedCompanies:[...crmCompanies,...previousCompanies],attempt:attempts.count ?? 0,call,signal,
        async remember(candidates) {
          const remembered = await db.from("ai_lead_company_history").upsert(candidates.map(candidate => ({domain:leadDomain(candidate.website),company_name:candidate.name,search_id:id})), {onConflict:"domain",ignoreDuplicates:true});
          if (remembered.error) throw databaseError(remembered.error);
        },
        async report(summary) { researchSummary = summary; },
        async progress(phase) {
          const { data, error } = await db.from("ai_lead_searches").update({phase,updated_at:now()}).eq("id",id).eq("status","running").select("id").maybeSingle();
          if (error) throw databaseError(error);
          if (!data) throw new Error("Search cancelled.");
        },
      });
      // A coworker may add a company while research is running. Recheck live
      // CRM identities before committing, including alternate URLs and names.
      const latestCrm = leadCompanyExclusions(await leadCrmIdentities());
      const freshResults = results.filter(lead => !latestCrm.has(lead));
      const finalSummary = researchSummary as LeadResearchSummary | null;
      if (finalSummary) { finalSummary.duplicates += results.length - freshResults.length; finalSummary.qualified = freshResults.length; }
      const saved = await db.from("ai_lead_searches").update({status:"complete",phase:freshResults.length ? "Research complete" : "No new qualified matches found",results:freshResults,research_summary:finalSummary,updated_at:now()}).eq("id",id).eq("status","running");
      if (saved.error) throw databaseError(saved.error);
    } catch (error) {
      const message = error instanceof Error && (error.name === "AiBudgetError" || error instanceof LeadError || /^(AI |This |Search |The company|The search|Public|Lead records)/.test(error.message)) ? error.message : "Research could not finish. Try fewer leads or a different location. No leads were automatically added.";
      const failed = await db.from("ai_lead_searches").update({status:"failed",phase:"Search stopped",error:message,updated_at:now()}).eq("id",id).eq("status","running");
      if (failed.error) console.error("Lead search failure could not be recorded",{code:failed.error.code});
    }
  });
}

export async function mutateLeadSearch(viewer: WorkspaceViewer, value: unknown) {
  writer(viewer);
  const parsed = leadMutationSchema.safeParse(value);
  if (!parsed.success) throw new LeadError("Choose a valid lead action.");
  return withWorkspaceViewer(viewer, async () => {
    const input = parsed.data, db = createSupabaseAdmin();
    if (input.action === "cancel") {
      const {error} = await db.from("ai_lead_searches").update({status:"cancelled",phase:"Cancelled",updated_at:new Date().toISOString()}).eq("id",input.searchId).in("status",["queued","running"]);
      if (error) throw databaseError(error);
      return {cancelled:true};
    }
    const {data:search,error} = await db.from("ai_lead_searches").select("status,results,context_key,criteria").eq("id",input.searchId).maybeSingle();
    if (error) throw databaseError(error);
    if (!search) throw new LeadError("Search not found in this workspace.",404);
    const lead = (search.results as LeadResult[]).find(lead=>lead.id===input.leadId);
    if (search.status!=="complete" || !lead) throw new LeadError("Choose a lead from a completed search.");
    if (input.action === "save") {
      if(!search.criteria?.audience)throw new LeadError("This earlier search needs a reviewed buyer profile. Update targeting and rerun it before saving.");
      if(!isQualifiedLead(lead))throw new LeadError("Only evidence-qualified companies can be added from AI Leads. Refine your targeting and search again.");
      const result = await db.rpc("save_ai_lead",{p_search_id:input.searchId,p_lead_id:input.leadId,p_actor_id:viewer.id});
      if (result.error) throw databaseError(result.error);
      return result.data as {companyId:string;existing:boolean;emailConflict:boolean};
    }
    const result = await db.from("ai_lead_feedback").upsert({context_key:search.context_key,domain:lead.domain,reason:input.reason,created_by:viewer.id,updated_at:new Date().toISOString()},{onConflict:"context_key,domain"});
    if (result.error) throw databaseError(result.error);
    // Feedback is authoritative in its own table; no race-prone result overwrite.
    return {feedback:input.reason};
  });
}
