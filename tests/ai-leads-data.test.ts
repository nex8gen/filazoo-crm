import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import * as leadTypes from "../lib/ai-leads.ts";
import * as prospecting from "../lib/lead-prospecting.ts";
import * as policy from "../lib/lead-discovery-policy.ts";

function workerFixture(historyFails=false) {
  const viewer={id:"actor",workspaceId:"tenant",role:"operator"};
  const crm=Array.from({length:501},(_,index)=>({name:"CRM company "+index,domain:"crm"+index+".com",website:null}));
  const history=Array.from({length:501},(_,index)=>({company_name:"Previous company "+index,domain:"previous"+index+".com",search_id:"older-search"}));
  const state:{status:string;results:unknown[];research_summary?:policy.LeadResearchSummary}={status:"queued",results:[]};
  const events:string[]=[];
  let aiCalls=0;
  const db={from(table:string){
    let mutation:Record<string,unknown>|undefined,head=false;
    const execute=()=>{
      if(table==="ai_lead_searches"){
        if(head)return{count:7,error:null};
        if(mutation){Object.assign(state,mutation);return{data:{id:"current-search",criteria:{country:"Germany"},products:[],feedback_context:[],context_key:"same-target"},error:null};}
      }
      return{data:null,error:null};
    };
    const query={
      select(_columns:string,options?:{head?:boolean}){head=Boolean(options?.head);return query;},
      update(values:Record<string,unknown>){mutation=values;return query;},
      eq(){return query;},neq(){return query;},order(){return query;},
      async range(start:number,end:number){
        events.push(table+":"+start);
        if(table==="ai_lead_company_history"&&historyFails)return{data:null,error:{code:"XX000"}};
        return{data:(table==="companies"?crm:history).slice(start,end+1),error:null};
      },
      async upsert(rows:typeof history){events.push("remember");history.push(...rows);return{error:null};},
      async maybeSingle(){return execute();},
      then(resolve:(value:unknown)=>unknown,reject:(cause:unknown)=>unknown){return Promise.resolve(execute()).then(resolve,reject);},
    };
    return query;
  }};
  const deps:Record<string,unknown>={
    "server-only":{},"node:crypto":{},"../supabase/admin.ts":{createSupabaseAdmin:()=>db},
    "../workspace-context.ts":{withWorkspaceViewer:async(actual:typeof viewer,work:()=>Promise<unknown>)=>{assert.equal(actual.workspaceId,"tenant");return work();}},
    "../ai-leads.ts":leadTypes,"../lead-prospecting.ts":prospecting,"../lead-discovery-policy.ts":policy,
    "../ai/lead-buyer-profile.ts":{},"./product-personalization.ts":{},"./ai-settings.ts":{requireAiFeature:async()=>({})},
    "../ai/lead-discovery.ts":{
      createLeadAiCall:async()=>{aiCalls++;return()=>{};},
      discoverLeads:async(options:{excludedCompanies:policy.LeadCompanyIdentity[];attempt:number;remember:(companies:unknown[])=>Promise<void>;report:(summary:policy.LeadResearchSummary)=>Promise<void>;progress:(phase:string)=>Promise<void>})=>{
        assert.equal(options.attempt,7);assert.equal(options.excludedCompanies.length,1002);
        assert.ok(options.excludedCompanies.some(company=>company.domain==="crm500.com"));
        assert.ok(options.excludedCompanies.some(company=>company.domain==="previous500.com"));
        await options.remember([{name:"Fresh Company",website:"https://fresh.com"}]);await options.progress("Checking fit");
        // Simulate a coworker saving this account while the AI is working.
        crm.push({name:"Added During Research",domain:"added.com",website:null});
        const results=[{id:"added.com",domain:"added.com",name:"Added During Research"},{id:"fresh.com",domain:"fresh.com",name:"Fresh Company"}];
        await options.report({version:3,queries:["hotels Germany"],candidates:4,duplicates:0,researched:4,unreadable:0,rejected:1,needsReview:1,noContact:0,qualified:2});
        return results;
      },
    },
  };
  const api={} as {runLeadSearch:(viewer:unknown,id:string)=>Promise<void>};
  const source=ts.transpileModule(readFileSync(new URL("../lib/data/ai-leads.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports:api,require:(name:string)=>{assert.ok(name in deps,"Unexpected dependency "+name);return deps[name];},AbortSignal,Date,console});
  return{run:()=>api.runLeadSearch(viewer,"current-search"),state,events,aiCalls:()=>aiCalls,history};
}
test("worker loads every CRM/history page before AI and excludes companies added while research runs",async()=>{
  const fixture=workerFixture();await fixture.run();
  assert.equal(fixture.aiCalls(),1);assert.equal(fixture.state.status,"complete");
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.state.results)).map((lead:{domain:string})=>lead.domain),["fresh.com"]);
  assert.equal(fixture.state.research_summary?.duplicates,1);assert.equal(fixture.state.research_summary?.qualified,1);
  assert.ok(fixture.events.includes("companies:500"));assert.ok(fixture.events.includes("ai_lead_company_history:500"));
  assert.equal(fixture.history.at(-1)?.domain,"fresh.com");
});
test("worker fails closed before paid AI when the duplicate registry cannot be loaded",async()=>{
  const fixture=workerFixture(true);await fixture.run();
  assert.equal(fixture.aiCalls(),0);assert.equal(fixture.state.status,"failed");assert.deepEqual(fixture.state.results,[]);
});
