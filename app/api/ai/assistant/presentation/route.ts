import { getWorkspaceViewer } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { requireAiFeature } from "@/lib/data/ai-settings";
import { restrictedAiContext } from "@/lib/ai-policy";
import { readCrmRecords } from "@/lib/ai/crm-records";
import { buildRecordPresentation, type RecordEvidence } from "@/lib/ai/record-presentation";
import { recordPreviewRequestSchema } from "@/lib/ai/response-presentation";

const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  let viewer: Awaited<ReturnType<typeof getWorkspaceViewer>>;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in to view these records." }, { status: 401, headers });
  const actor = viewer;
  return withWorkspaceViewer(actor, async () => {
    try {
      const policy = await requireAiFeature("chat");
      if (restrictedAiContext(policy)) return Response.json({ error: "Record previews are unavailable with the current AI data settings." }, { status: 403, headers });
      // This endpoint accepts bounded identifiers only, never model-provided card values.
      const raw = await request.text();
      if (raw.length > 4000) return Response.json({ error: "Choose up to ten linked records." }, { status: 400, headers });
      let body: unknown;
      try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid record preview request." }, { status: 400, headers }); }
      const parsed = recordPreviewRequestSchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: "Invalid record preview request." }, { status: 400, headers });
      const records = [...new Map(parsed.data.records.map(item => [`${item.resource}:${item.id}`, item])).values()];
      const results = await Promise.allSettled(records.map(async item => {
        const result = await readCrmRecords(actor, { ...item, query: "", offset: 0 });
        return { resource: item.resource, records: result.records, coverage: result.coverage } satisfies RecordEvidence;
      }));
      const evidence = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      const presentation = buildRecordPresentation(evidence, records.map(item => item.resource).join(" "));
      if (!presentation) return Response.json({ error: "These records could not be loaded with your current access." }, { status: 403, headers });
      return Response.json({ presentation, partial: results.some(result => result.status === "rejected") }, { headers });
    } catch {
      return Response.json({ error: "Unable to load record cards. Please try again." }, { status: 503, headers });
    }
  });
}
