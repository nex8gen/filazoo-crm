import { NextResponse } from "next/server";
export function GET(){return NextResponse.json({status:"ok",service:"filazoo-crm",dryRun:process.env.DRY_RUN!=="false",timestamp:new Date().toISOString()})}
