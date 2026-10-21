import { runAutomationDiagnostics } from "@/lib/automation-diagnostics";
export async function POST(){return Response.json({...runAutomationDiagnostics(),timestamp:new Date().toISOString(),liveSending:false,aiMode:process.env.GEMINI_API_KEY?"gemini-configured":"mock"},{status:200,headers:{"Cache-Control":"no-store"}})}
