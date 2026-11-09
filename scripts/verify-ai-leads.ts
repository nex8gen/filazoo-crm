// Bounded live smoke test. Uses existing Gateway credits, never sends messages.
// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-ai-leads.ts --live
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSupabaseControl } from "../lib/supabase/control.ts";
import { withWorkspaceContext } from "../lib/workspace-context.ts";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { leadProductOptions, prepareLeadProfile, startLeadSearch, runLeadSearch, listLeadSearches, mutateLeadSearch } from "../lib/data/ai-leads.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

if(!process.argv.includes("--live")){console.log("Use --live to run one three-company search, capped at $0.20 of existing Gateway credits. Disposable search and CRM records are cleaned up.");process.exit(0);}
const control=createSupabaseControl();
const {data:workspace}=await control.from("workspaces").select("id,name,owner_id").eq("is_legacy",true).single().throwOnError();
const viewer:WorkspaceViewer={id:workspace!.owner_id,email:null,role:"admin",displayName:"Lead verification",workspaceId:workspace!.id,workspaceName:workspace!.name,ownerId:workspace!.owner_id};
let searchId:string|undefined,createdCompanyId:string|undefined;
let feedbackKey:string|undefined,feedbackDomain:string|undefined,previousFeedback:Record<string,unknown>|null=null;
try{
  const catalog=await leadProductOptions(viewer);assert.ok(catalog.length,"Active workspace catalog is required for this live check.");
  const asa=process.argv.includes("--asa");
  const product=catalog.find(product=>asa ? /^ASA$/i.test(product.name) : /PLA/i.test(product.name))??catalog[0];
  const profile=await prepareLeadProfile(viewer,{productSkus:[product.sku],productContext:""});
  assert.equal(profile.clarity,"clear","The selected product must resolve before searching.");
  console.log(JSON.stringify({stage:"buyer-profile",category:profile.category,definition:profile.definition,groups:profile.segments.map(segment=>({id:segment.id,label:segment.label,role:segment.role}))}));
  const chosen=profile.segments.filter(segment=>["end_user","service_provider"].includes(segment.role)).slice(0,3);
  assert.ok(chosen.length,"Expected product users or service providers.");
  const input={requestId:randomUUID(),productSkus:[product.sku],profileId:profile.id,segmentIds:chosen.map(segment=>segment.id),productContext:"",country:asa?"United States":"Germany",city:"",buyerTypes:"",requirements:"",exclusions:"",limit:3};
  const created=await startLeadSearch(viewer,input);searchId=created.search.id;
  console.log(JSON.stringify({stage:"started",product:product.name,searchId,limit:3,maximumReservedUsd:0.20}));
  await runLeadSearch(viewer,searchId);
  const result=(await listLeadSearches(viewer)).find(search=>search.id===searchId)!;
  console.log(JSON.stringify({stage:"finished",status:result.status,error:result.error,results:result.results.map(lead=>({name:lead.name,website:lead.website,qualification:lead.qualification,buyerGroup:lead.buyerGroup,checks:lead.checks,emailCount:lead.emails.length,phoneCount:lead.phones.length,sourceCount:lead.sources.length}))}));
  assert.equal(result.status,"complete",result.error??"Live research did not complete");
  assert.ok(result.results.length,"Expected at least one sourced real business.");
  assert.ok(result.results.some(lead=>lead.emails.length>0),"Expected a published email from at least one company.");
  if(asa){assert.ok(result.results.every(lead=>lead.domain!=="asasupplies.com"),"Acronym collision returned an unrelated PPE supplier");assert.ok(result.results.some(lead=>lead.qualification==="qualified"),"Expected evidence supporting an actual product match.");}
  for(const lead of result.results){assert.ok(lead.sources.length);assert.ok(lead.emails.every(email=>email.status==="unverified"));}
  const candidate=result.results.find(lead=>lead.qualification!=="rejected"&&!lead.existingCompanyId&&lead.emails.length);
  if(candidate){
    const saved=await mutateLeadSearch(viewer,{action:"save",searchId,leadId:candidate.id}) as {companyId:string;existing:boolean};
    if(!saved.existing)createdCompanyId=saved.companyId;
    const again=await mutateLeadSearch(viewer,{action:"save",searchId,leadId:candidate.id}) as {companyId:string;existing:boolean};
    assert.equal(again.companyId,saved.companyId);assert.equal(again.existing,true);
    await withWorkspaceContext(viewer.workspaceId,async()=>{
      const {data:contacts}=await createSupabaseAdmin().from("contacts").select("verification_status").eq("company_id",saved.companyId).throwOnError();
      assert.ok(contacts!.length);assert.ok(contacts!.every(contact=>contact.verification_status==="unverified"));
    },viewer.id);
    await withWorkspaceContext(viewer.workspaceId,async()=>{
      const db=createSupabaseAdmin();
      const {data:search}=await db.from("ai_lead_searches").select("context_key").eq("id",searchId!).single().throwOnError();
      feedbackKey=search!.context_key;feedbackDomain=candidate.domain;
      const {data:previous}=await db.from("ai_lead_feedback").select("*").eq("context_key",feedbackKey!).eq("domain",candidate.domain).maybeSingle().throwOnError();
      previousFeedback=previous;
    },viewer.id);
    await mutateLeadSearch(viewer,{action:"feedback",searchId,leadId:candidate.id,reason:"good_match"});
    const updated=(await listLeadSearches(viewer)).find(search=>search.id===searchId)!;
    assert.equal(updated.results.find(lead=>lead.id===candidate.id)?.feedback,"good_match");
    console.log("PASS live source-backed discovery, contact extraction, atomic CRM save, duplicate protection, unverified contacts and persisted feedback");
  }
}finally{
  await withWorkspaceContext(viewer.workspaceId,async()=>{
    const db=createSupabaseAdmin();
    if(createdCompanyId)await db.from("companies").delete().eq("id",createdCompanyId).throwOnError();
    if(feedbackKey&&feedbackDomain){
      if(previousFeedback)await db.from("ai_lead_feedback").upsert(previousFeedback,{onConflict:"context_key,domain"}).throwOnError();
      else await db.from("ai_lead_feedback").delete().eq("context_key",feedbackKey).eq("domain",feedbackDomain).throwOnError();
    }
    if(searchId){
      await db.from("ai_lead_searches").delete().eq("id",searchId).throwOnError();
    }
  },viewer.id);
}
