import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(options:{unauthorized?:boolean;denied?:boolean;failure?:boolean;created?:boolean;profile?:boolean}={}){
  const calls:string[]=[],jobs:Array<()=>Promise<void>>=[];
  class LeadError extends Error { status:number;constructor(message:string,status=400){super(message);this.status=status;} }
  const service=async(name:string)=>{calls.push(name);if(options.denied)throw new LeadError("Your role cannot write",403);if(options.failure)throw new Error("Private database credentials");};
  const deps:Record<string,unknown>={
    "next/server":{after:(job:()=>Promise<void>)=>jobs.push(job)},
    "next/cache":{revalidatePath:(path:string)=>calls.push(path)},
    "@/lib/auth":{getWorkspaceViewer:async()=>options.unauthorized?null:{id:"real-user",workspaceId:"real-workspace",role:"operator"}},
    "@/lib/data/ai-leads":{LeadError,prepareLeadProfile:async(viewer:{workspaceId:string},body:unknown)=>{assert.equal(viewer.workspaceId,"real-workspace");assert.ok(body);await service("profile");return{id:"profile",category:"Commercial furniture"};},listLeadSearches:async()=>{await service("read");return[];},startLeadSearch:async(viewer:{workspaceId:string},body:unknown)=>{assert.equal(viewer.workspaceId,"real-workspace");assert.ok(body);await service("start");return{search:{id:"new-search"},created:options.created!==false};},runLeadSearch:async(viewer:{id:string},id:string)=>{assert.equal(viewer.id,"real-user");assert.equal(id,"new-search");calls.push("run");},mutateLeadSearch:async()=>{await service("mutate");return{companyId:"saved-company"};}},
  };
  (deps["@/lib/data/ai-leads"] as Record<string,unknown>).getLeadAllowance=async()=>({availableMicros:64648,scope:"daily",enabled:true,resetsAt:"2026-11-09T16:00:00Z"});
  const api={} as {GET:()=>Promise<Response>;POST:(request:Request)=>Promise<Response>;PATCH:(request:Request)=>Promise<Response>};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(options.profile?"../app/api/ai/leads/profile/route.ts":"../app/api/ai/leads/route.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,require:(name:string)=>deps[name],Response,URL,console,SyntaxError});
  return{api,calls,jobs};
}
const request=(method="POST",origin:string|null="https://crm.test",body='{"action":"save"}')=>new Request("https://crm.test/api/ai/leads",{method,headers:{...(origin?{origin}:{}),"content-type":"application/json"},body});

test("lead routes reject anonymous users and cross-site writes before private data access",async()=>{
  const denied=load({unauthorized:true});assert.equal((await denied.api.GET()).status,401);assert.equal((await denied.api.POST(request())).status,401);assert.equal((await denied.api.PATCH(request("PATCH"))).status,401);assert.deepEqual(denied.calls,[]);
  const authenticated=load();for(const origin of [null,"https://attacker.test"]){assert.equal((await authenticated.api.POST(request("POST",origin))).status,403);assert.equal((await authenticated.api.PATCH(request("PATCH",origin))).status,403);}assert.deepEqual(authenticated.calls,[]);
});
test("a persisted search runs after the response once, and idempotent requests do not repeat paid work",async()=>{
  const fresh=load();const result=await fresh.api.POST(request());assert.equal(result.status,202);assert.deepEqual(fresh.calls,["start"]);assert.equal(fresh.jobs.length,1);await fresh.jobs[0]();assert.deepEqual(fresh.calls,["start","run"]);
  const previous=load({created:false});assert.equal((await previous.api.POST(request())).status,200);assert.equal(previous.jobs.length,0);
});
test("lead APIs return uncached results and hide internal errors",async()=>{
  const response=await load().api.GET();assert.equal(response.headers.get("cache-control"),"private, no-store");
  const failed=await load({failure:true}).api.GET();assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/credentials/);
  assert.equal((await load({denied:true}).api.POST(request())).status,403);
  assert.equal((await load().api.POST(request("POST","https://crm.test","invalid"))).status,400);
});
test("saving a lead refreshes company views without authorizing any email send",async()=>{
  const {api,calls}=load();assert.equal((await api.PATCH(request("PATCH"))).status,200);assert.deepEqual(calls,["mutate","/companies","/analytics"]);
});
test("buyer profile preparation authenticates, rejects cross-site calls and does not start company research",async()=>{
  const anonymous=load({profile:true,unauthorized:true});assert.equal((await anonymous.api.POST(request())).status,401);assert.deepEqual(anonymous.calls,[]);
  const authenticated=load({profile:true});assert.equal((await authenticated.api.POST(request("POST","https://attacker.test"))).status,403);assert.deepEqual(authenticated.calls,[]);
  const result=await authenticated.api.POST(request());assert.equal(result.status,200);assert.equal(result.headers.get("cache-control"),"private, no-store");assert.deepEqual(authenticated.calls,["profile"]);assert.equal(authenticated.jobs.length,0);
  const failed=await load({profile:true,failure:true}).api.POST(request());assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/credentials/);
});
