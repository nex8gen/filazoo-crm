import { NextResponse } from "next/server";
import { env, hasSupabaseConfig } from "@/lib/env";
import { createSupabaseControl } from "@/lib/supabase/control";

export async function GET(){
  let database:"connected"|"not-configured"|"error"="not-configured";
  if(hasSupabaseConfig()){
    try{
      // Platform liveness must not depend on a visitor's workspace or session.
      const {error}=await createSupabaseControl().from("workspaces").select("id").limit(1).abortSignal(AbortSignal.timeout(5_000));
      database=error?"error":"connected";
    }catch{database="error"}
  }
  const healthy=database==="connected";
  return NextResponse.json({status:healthy?"ok":"degraded",service:"filazoo-crm",database,dryRun:env.dryRun,flowDryRun:env.flowDryRun,timestamp:new Date().toISOString()},{status:healthy?200:503,headers:{"Cache-Control":"no-store"}});
}
