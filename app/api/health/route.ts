import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(){
  let database:"connected"|"not-configured"|"error"="not-configured";
  if(hasSupabaseConfig()){
    try{
      const {error}=await createSupabaseAdmin().from("companies").select("id",{count:"exact",head:true});
      database=error?"error":"connected";
    }catch{database="error"}
  }
  const healthy=database!=="error";
  return NextResponse.json({status:healthy?"ok":"degraded",service:"filazoo-crm",database,dryRun:process.env.DRY_RUN!=="false",timestamp:new Date().toISOString()},{status:healthy?200:503});
}
