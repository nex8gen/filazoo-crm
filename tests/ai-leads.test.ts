import assert from "node:assert/strict";
import test from "node:test";
import { buildLeadResult, leadSearchSchema, supportedProof, type BusinessPage, type LeadProduct, type LeadSearchInput } from "../lib/ai-leads.ts";
import { parseBusinessPage, publicBusinessAddress } from "../lib/public-business-page.ts";
import { businessEvidenceExcerpt, discoverLeads, responseSources, type LeadAiCall } from "../lib/ai/lead-discovery.ts";
import { generateBuyerProfile } from "../lib/ai/lead-buyer-profile.ts";
import { qualificationFromChecks } from "../lib/lead-prospecting.ts";
import { isQualifiedLead, leadCompanyExclusions, leadSearchPlan, type LeadCompanyIdentity, type LeadResearchSummary } from "../lib/lead-discovery-policy.ts";

const input:LeadSearchInput={requestId:"a0d679de-66de-4cb9-836a-1aa1b1958175",productSkus:["CHAIR"],country:"Germany",city:"Berlin",buyerTypes:"Hotels",requirements:"",exclusions:"",limit:3};
const products:LeadProduct[]=[{sku:"CHAIR",name:"Commercial dining chairs",description:"Durable seating for hotels and restaurants",moq:20}];
const page:BusinessPage={url:"https://hotel.testdomain.com/contact",text:"Example Hotel runs a restaurant with 100 dining seats. Visit us in Berlin, Germany. Purchasing contact Alice Smith: buying@hotel.testdomain.com. Phone +49 30 1234567.",emails:["buying@hotel.testdomain.com"],phones:["+49 30 1234567"],links:[]};
const proof=(value:string,quote:string)=>({value,quote,sourceUrl:page.url});
const assessment={domain:"hotel.testdomain.com",segment:"Hotel",summary:"Hotel with a restaurant",locationMatches:true,buyerMatches:true,requirementsMet:true,excluded:false,matchedProducts:["CHAIR","invented"],fitEvidence:proof("Restaurant seating application","Example Hotel runs a restaurant with 100 dining seats."),locationEvidence:proof("Berlin, Germany","Visit us in Berlin, Germany."),buyingIntent:null,address:null,contactName:proof("Alice Smith","Purchasing contact Alice Smith: buying@hotel.testdomain.com."),contactRole:null};
const payload=(data:unknown,urls:string[]=[])=>({output:[{type:"web_search_call",action:{sources:urls.map(url=>({type:"url",url}))}},{type:"message",content:[{type:"output_text",text:JSON.stringify(data)}]}]});

test("search requires workspace products or a real product description and bounds paid work",()=>{
  assert.equal(leadSearchSchema.safeParse(input).success,true);
  assert.equal(leadSearchSchema.safeParse({...input,productSkus:[]}).success,false);
  assert.equal(leadSearchSchema.safeParse({...input,productSkus:[],customProduct:{name:"Seats",description:"Dining chairs for commercial hospitality"}}).success,true);
  assert.equal(leadSearchSchema.safeParse({...input,limit:100}).success,false);
  assert.equal(leadSearchSchema.safeParse({...input,workspaceId:"other"}).success,false);
});
test("public contact extraction ignores hidden code, rejects unrelated links and never fabricates emails",()=>{
  const result=parseBusinessPage('<script>steal@hidden.com</script><style>bad@style.com</style><a href="mailto:SALES@vendor.com?subject=Hi">Sales</a><a href="tel:+49 30 1234567">Call</a><a href="/contact">Contact</a><a href="https://other.com/contact">Elsewhere</a><p>hello@vendor.com</p>',"https://vendor.com/");
  assert.deepEqual(result.emails,["sales@vendor.com","hello@vendor.com"]);
  assert.deepEqual(result.phones,["+49 30 1234567"]);
  assert.deepEqual(result.links,["https://vendor.com/contact"]);
  assert.doesNotMatch(result.text,/steal|hidden|bad@/);
});
test("connection address validation blocks private, mapped, metadata and reserved destinations",()=>{
  for(const address of ["127.0.0.1","169.254.169.254","10.0.0.5","192.168.1.2","100.64.0.1","198.18.0.1","::1","::ffff:127.0.0.1","fc00::1","2001:db8::1"])assert.equal(publicBusinessAddress(address),false,address);
  assert.equal(publicBusinessAddress("8.8.8.8"),true);
  assert.equal(publicBusinessAddress("2606:4700:4700::1111"),true);
});
test("supported fit requires quoted official evidence; public contacts stay unverified and intent unknown",()=>{
  const result=buildLeadResult({name:"Example Hotel",website:"https://hotel.testdomain.com"},{...assessment,emails:["invented@fake.com"]},[page],products,input,"2026-11-09T01:00:00Z");
  assert.equal(result.confidence,"supported");assert.equal(result.fitScore,100);assert.equal(result.buyingIntent,null);
  assert.deepEqual(result.emails,[{value:"buying@hotel.testdomain.com",sourceUrl:page.url,status:"unverified"}]);
  assert.deepEqual(result.matchedProducts,["Commercial dining chairs"]);
  const fake=buildLeadResult({name:"Example Hotel",website:"https://hotel.testdomain.com"},{...assessment,locationEvidence:proof("Berlin","Invented location quote"),contactName:proof("Bob","Purchasing contact Alice Smith: buying@hotel.testdomain.com.")},[page],products,input,"now");
  assert.equal(fake.confidence,"needs_review");assert.ok(fake.fitScore<50);assert.equal(fake.country,"");assert.equal(fake.contactName,null);
});
test("exclusions and unknown required qualifications cannot receive high fit",()=>{
  for(const changed of [{excluded:true},{requirementsMet:false},{buyerMatches:false},{matchedProducts:[]}]){
    const result=buildLeadResult({name:"Example Hotel",website:"https://hotel.testdomain.com"},{...assessment,...changed},[page],products,input,"now");
    assert.equal(result.confidence,"needs_review");assert.ok(result.fitScore<50);
  }
});
test("discovery uses supplied workspace products, admits cited domains only, reads websites and assesses with two calls",async()=>{
  let calls=0;const read:string[]=[];
  const call:LeadAiCall=async body=>{
    calls++;assert.match(String(body.input),/Commercial dining chairs/);assert.doesNotMatch(String(body.input),/FILAZOO|filament/);
    if(calls===1){assert.equal(body.max_tool_calls,1);return payload({candidates:[{name:"Example Hotel",website:"https://hotel.testdomain.com"},{name:"Invented",website:"https://invented.com"},{name:"Duplicate",website:"https://hotel.testdomain.com/about"}]},[page.url]);}
    assert.match(String(body.input),/Alice Smith/);return payload({assessments:[v2Assessment]});
  };
  const result=await discoverLeads({input:v2Input,products,call,signal:AbortSignal.timeout(10000),progress:async()=>{},readWebsite:async website=>{read.push(website);return[page];}});
  assert.equal(calls,2);assert.equal(read.length,1);assert.equal(result.length,1);assert.equal(result[0].qualification,"qualified");
});
test("no actual search sources fails closed and cancellation prevents later paid stages",async()=>{
  await assert.rejects(()=>discoverLeads({input,products,call:async()=>payload({candidates:[{name:"Fake",website:"https://fake.com"}]}),signal:AbortSignal.timeout(10000),progress:async()=>{}}),/no verifiable web sources/);
  let calls=0;
  await assert.rejects(()=>discoverLeads({input,products,call:async()=>{calls++;return payload({candidates:[{name:"Hotel",website:"https://hotel.testdomain.com"}]},[page.url]);},signal:AbortSignal.timeout(10000),progress:async phase=>{if(phase.startsWith("Reading"))throw new Error("Cancelled");}}),/Cancelled/);
  assert.equal(calls,1);
});
test("search source collection rejects unsafe URLs",()=>{assert.deepEqual(responseSources(payload({},["http://127.0.0.1/","http://localhost/","https://hotel.testdomain.com/contact"])),[page.url]);});

const segment={id:"hotels",label:"Hotels and hospitality",role:"end_user" as const,reason:"Use commercial chairs in restaurants and dining rooms.",searchTerms:["hotels with restaurants","hospitality venues"]};
const v2Input:LeadSearchInput={...input,audience:{category:"Commercial furniture",definition:"Dining chairs for hotels and restaurants.",segments:[segment],contactRoles:["Purchasing manager"]}};
const v2Assessment={...assessment,segmentId:"hotels",observedRole:"end_user",buyerEvidence:proof("Hotel restaurant operation","Example Hotel runs a restaurant with 100 dining seats."),productStatus:"met",locationStatus:"met",buyerStatus:"met",requirementStatus:"met",identityStatus:"met",identityEvidence:proof("Example Hotel","Example Hotel runs a restaurant with 100 dining seats."),productReason:"Runs a restaurant with dining seating.",locationReason:"Publishes an address in Berlin, Germany.",buyerReason:"Matches the selected hotel buyer group.",requirementReason:"No extra requirements.",identityReason:"Official website names Example Hotel.",fitStrength:"application"};
test("qualification distinguishes an unknown fact from an actual disqualification",()=>{
  const make=(changes:Record<string,unknown>)=>buildLeadResult({name:"Example Hotel",website:"https://hotel.testdomain.com"},{...v2Assessment,...changes},[page],products,v2Input,"now");
  assert.equal(make({}).qualification,"qualified");
  assert.ok(make({}).fitScore<100,"No fabricated perfect score for a company without buying intent");
  assert.equal(make({locationStatus:"unknown",locationEvidence:null}).qualification,"review");
  assert.equal(make({locationStatus:"not_met",locationReason:"Outside target city."}).qualification,"rejected");
  assert.equal(make({productStatus:"not_met",matchedProducts:[],productReason:"Unrelated product acronym."}).qualification,"rejected");
  assert.equal(make({identityStatus:"not_met",identityEvidence:null}).qualification,"rejected");
  assert.equal(make({segmentId:"invented-buyer"}).qualification,"review");
  assert.equal(make({observedRole:"reseller"}).qualification,"rejected","Selling to a buyer group is not performing that group's activity.");
  assert.equal(make({buyerEvidence:null}).qualification,"review");
  assert.equal(make({identityEvidence:proof("Invented hotel","Example Hotel runs a restaurant with 100 dining seats.")}).qualification,"review");
});
test("qualification never uses a published email as proof of product relevance",()=>{
  const result=buildLeadResult({name:"Example Hotel",website:"https://hotel.testdomain.com"},{...v2Assessment,productStatus:"unknown",fitEvidence:null},[page],products,v2Input,"now");
  assert.equal(result.emails.length,1);assert.equal(result.qualification,"review");
  assert.equal(qualificationFromChecks([{key:"product",label:"Product",state:"unknown",reason:"Missing"}]),"review");
});
test("short official brand names are accepted as identity evidence without matching word suffixes",()=>{
  const brandPage={...page,text:"ply builds custom parts. Contact our team."};
  assert.ok(supportedProof(proof("ply","ply"),[brandPage],true,2));
  assert.equal(supportedProof(proof("ply","ply"),[{...page,text:"We supply materials to others."}],true,2),null);
});
test("buyer profiling supports another industry and never performs a web search to interpret a catalog",async()=>{
  let calls=0;
  const profile=await generateBuyerProfile(products,"Commercial furniture",async body=>{
    calls++;assert.equal(body.tools,undefined);assert.match(String(body.input),/Commercial dining chairs/);
    return payload({category:"Commercial furniture",definition:"Durable dining chairs for restaurants and hospitality.",clarity:"clear",clarification:"",segments:[{...segment,searchTerms:["hotels","restaurants","hospitality","fourth redundant suggestion"]}],excludeHints:["Competing furniture factories"],contactRoles:["Purchasing manager"]});
  },AbortSignal.timeout(10000));
  assert.equal(calls,1);assert.equal(profile.category,"Commercial furniture");assert.equal(profile.segments[0].role,"end_user");assert.equal(profile.segments[0].searchTerms.length,3);
});
test("evidence excerpts retain company identity, relevant activity and footer address within a token bound",()=>{
  const long={...page,text:"Example Hotel official website. "+"Navigation ".repeat(800)+"We operate a hotel restaurant with commercial dining chairs. "+"Other content ".repeat(700)+"Our location is Berlin, Germany."};
  const excerpt=businessEvidenceExcerpt(long,["commercial dining chairs","Berlin"],2500);
  assert.ok(excerpt.length<=2500);assert.match(excerpt,/Example Hotel/);assert.match(excerpt,/commercial dining chairs/);assert.match(excerpt,/Berlin, Germany/);
});

test("duplicate matching handles CRM website variants, subdomains and legal names without merging unrelated tenants",()=>{
  const known=leadCompanyExclusions([{name:"Acme Labs, LLC",domain:"WWW.Acme.com.",website:"https://acme.com/contact"},{name:"Merchant One",domain:"one.myshopify.com"}]);
  for(const company of [{name:"Search alias",website:"https://acme.com/"},{name:"Regional office",website:"https://sales.acme.com"},{name:"Acme Labs Ltd.",website:"https://alternate-brand.com"}])assert.equal(known.has(company),true);
  assert.equal(known.has({name:"Merchant Two",website:"https://two.myshopify.com"}),false);
  assert.equal(known.has({name:"Unrelated Acme Supplier",website:"https://notacme.com"}),false);
});
test("repeated searches rotate real buyer activities and preserve the exact target location",()=>{
  const first=leadSearchPlan(v2Input,0,["already-known.com"]),next=leadSearchPlan(v2Input,1,["already-known.com"]);
  assert.notDeepEqual(first,next);
  assert.ok(first.every(query=>query.includes("Berlin Germany")&&query.includes("-site:already-known.com")));
  assert.match(next[0],/hospitality venues/);
});
test("unsupported process fit, wrong target quotes and unquoted must-have requirements cannot qualify",()=>{
  const make=(changes:Record<string,unknown>,criteria=v2Input)=>buildLeadResult({name:"Example Hotel",website:"https://hotel.testdomain.com"},{...v2Assessment,...changes},[page],products,criteria,"now");
  assert.equal(isQualifiedLead(make({})),true);
  assert.equal(isQualifiedLead(make({fitStrength:"none"})),false);
  assert.equal(isQualifiedLead(make({},{...v2Input,country:"France"})),false);
  assert.equal(isQualifiedLead(make({},{...v2Input,city:"Hamburg"})),false);
  const required={...v2Input,requirements:"Restaurant must have at least 100 dining seats"};
  assert.equal(isQualifiedLead(make({},required)),false);
  assert.equal(isQualifiedLead(make({requirementEvidence:proof("100 dining seats","Example Hotel runs a restaurant with 100 dining seats.")},required)),true);
});

function researchFixture(name:string,domain:string,changes:Record<string,unknown>={},contacts=true){
  const replace=(value:unknown)=>JSON.parse(JSON.stringify(value).replaceAll("hotel.testdomain.com",domain).replaceAll("Example Hotel",name).replaceAll("/contact","/about"));
  const official=replace(page) as BusinessPage;
  if(!contacts){official.emails=[];official.phones=[];}
  return {candidate:{name,website:"https://"+domain+"/"},page:official,assessment:{...replace(v2Assessment),...changes}};
}
test("new-account discovery over-samples, returns only qualified contactable prospects, and remembers rejected candidates across runs",async()=>{
  const fixtures=[researchFixture("Known Hotel","crmhotel.com"),researchFixture("Previous Hotel","previoushotel.com"),researchFixture("New Hotel","newhotel.com"),researchFixture("Another Hotel","anotherhotel.com"),researchFixture("Wrong Role","wrongrole.com",{observedRole:"manufacturer"}),researchFixture("Unknown Location","unknownlocation.com",{locationStatus:"unknown",locationEvidence:null}),researchFixture("No Contact Hotel","nocontact.com",{},false)];
  const memory:LeadCompanyIdentity[]=[{name:"Known Hotel LLC",website:"https://www.crmhotel.com/"},{name:"Previous Hotel",domain:"previoushotel.com"}];
  const read:string[]=[],plans:string[]=[],reports:LeadResearchSummary[]=[];let calls=0;
  const run=async(pool:typeof fixtures,attempt:number)=>discoverLeads({input:v2Input,products,excludedCompanies:[...memory],attempt,signal:AbortSignal.timeout(10000),progress:async()=>{},
    call:async body=>{calls++;if(body.tools){plans.push(String(body.input));assert.match(String(body.input),/pool of up to 9/);return payload({candidates:pool.map(item=>item.candidate)},pool.map(item=>item.page.url));}return payload({assessments:pool.map(item=>item.assessment)});},
    remember:async candidates=>{memory.push(...candidates.map(candidate=>({name:candidate.name,website:candidate.website})));},
    report:async summary=>{reports.push(summary);},
    readWebsite:async website=>{assert.ok(memory.some(company=>company.website===website),"Remember candidates before reading");read.push(website);return[pool.find(item=>item.candidate.website===website)!.page];},
  });
  const first=await run(fixtures,0);
  assert.deepEqual(first.map(lead=>lead.domain).sort(),["anotherhotel.com","newhotel.com"]);
  assert.equal(first.length,2,"Do not pad a three-company request with weak leads");assert.ok(first.every(isQualifiedLead));
  assert.equal(read.length,5);assert.equal(reports[0].duplicates,2);assert.equal(reports[0].rejected,1);assert.equal(reports[0].needsReview,1);assert.equal(reports[0].noContact,1);
  const fresh=researchFixture("Fresh Hotel","freshhotel.com");
  const second=await run([...fixtures,fresh],1);
  assert.deepEqual(second.map(lead=>lead.domain),["freshhotel.com"]);
  assert.equal(read.length,6,"Already researched websites, including rejected ones, must not be reread");
  assert.equal(reports[1].duplicates,7);assert.notEqual(plans[0],plans[1]);assert.equal(calls,4);
});
test("an all-duplicate search skips website reads and the paid qualification call",async()=>{
  let calls=0,reads=0,report:LeadResearchSummary|undefined;
  const results=await discoverLeads({input:v2Input,products,excludedCompanies:[{name:"Example Hotel",domain:"hotel.testdomain.com"}],call:async()=>{calls++;return payload({candidates:[{name:"Example Hotel",website:"https://www.hotel.testdomain.com"}]},[page.url]);},signal:AbortSignal.timeout(10000),progress:async()=>{},readWebsite:async()=>{reads++;return[page];},report:async value=>{report=value;}});
  assert.deepEqual(results,[]);assert.equal(calls,1);assert.equal(reads,0);assert.equal(report?.duplicates,1);
});
