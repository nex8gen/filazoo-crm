import { hasAiProvider } from "@/lib/ai/provider-credentials";
import { runAutomationDiagnostics } from "@/lib/automation-diagnostics";
export async function POST(){return Response.json({...runAutomationDiagnostics(),timestamp:new Date().toISOString(),liveSending:false,aiMode:hasAiProvider()?"vercel-ai-gateway":"unconfigured"},{status:200,headers:{"Cache-Control":"no-store"}})}
