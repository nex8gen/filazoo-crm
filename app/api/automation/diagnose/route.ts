import { runAutomationDiagnostics } from "@/lib/automation-diagnostics";
export async function POST(){return Response.json({...runAutomationDiagnostics(),timestamp:new Date().toISOString(),liveSending:false,aiMode:process.env.ANTHROPIC_API_KEY?"configured-not-exposed":"mock"},{status:200,headers:{"Cache-Control":"no-store"}})}
