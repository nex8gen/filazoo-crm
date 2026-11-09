import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getWorkspaceViewer } from "@/lib/auth";
import { LeadError, listLeadSearches, mutateLeadSearch, runLeadSearch, startLeadSearch } from "@/lib/data/ai-leads";

export const maxDuration = 180;
const headers = { "Cache-Control":"private, no-store" };
function failure(error: unknown) {
  return Response.json({error:error instanceof LeadError ? error.message : "AI Leads is temporarily unavailable. Please try again."},{status:error instanceof LeadError ? error.status : 503,headers});
}
function sameOrigin(request: Request) { return request.headers.get("origin") === new URL(request.url).origin; }
export async function GET() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({error:"Sign in to an active workspace."},{status:401,headers});
  try { return Response.json({searches:await listLeadSearches(viewer)},{headers}); }
  catch(error) { return failure(error); }
}
export async function POST(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({error:"Sign in to an active workspace."},{status:401,headers});
  if (!sameOrigin(request)) return Response.json({error:"Open AI Leads in this CRM to start a search."},{status:403,headers});
  if (Number(request.headers.get("content-length") ?? 0)>20000) return Response.json({error:"Search request is too large."},{status:413,headers});
  try {
    const body = await request.json().catch(()=>{throw new LeadError("Enter a valid search.");});
    const {search,created} = await startLeadSearch(viewer,body);
    if (created) after(()=>runLeadSearch(viewer,search.id));
    return Response.json({search},{status:created ? 202 : 200,headers});
  } catch(error) { return failure(error); }
}
export async function PATCH(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({error:"Sign in to an active workspace."},{status:401,headers});
  if (!sameOrigin(request)) return Response.json({error:"Open AI Leads in this CRM to update leads."},{status:403,headers});
  try {
    const body = await request.json().catch(()=>{throw new LeadError("Choose a valid action.");});
    const result = await mutateLeadSearch(viewer,body);
    if (body.action === "save") { revalidatePath("/companies"); revalidatePath("/analytics"); }
    return Response.json(result,{headers});
  } catch(error) { return failure(error); }
}
