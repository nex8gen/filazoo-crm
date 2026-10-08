import { z } from "zod";
import { runMockProfileAgent } from "@/lib/ai/mock-agent";
const requestSchema=z.object({companyName:z.string().min(2).max(120),websiteSummary:z.string().min(20).max(3000)});
export async function POST(request:Request){const parsed=requestSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:"Invalid company input",issues:parsed.error.issues},{status:400});return Response.json({profile:runMockProfileAgent(parsed.data),notice:"Safe mock mode: no paid AI request was made."},{headers:{"Cache-Control":"no-store"}})}
