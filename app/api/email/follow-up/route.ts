import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { followupContextSchema, followupSaveSchema } from "@/lib/email-followup";
import { listFollowupActions, readFollowupStatus } from "@/lib/data/email-followup-status";
import { withWorkspaceViewer } from "@/lib/workspace-context";

export const maxDuration = 90;
const statusSchema = followupContextSchema.extend({ anchors: z.array(z.string().min(1).max(1100)).max(100) });
export async function GET(request: Request) {
  const start = performance.now();
  const viewer = await loadViewer();
  if (viewer instanceof Response) return viewer;
  if (!viewer) return unauthenticated();
  const authorizedAt = performance.now();
  const params = new URL(request.url).searchParams;
  if (params.get("view") === "list") {
    const mailbox = z.string().min(1).max(200).safeParse(params.get("mailboxId"));
    if (!mailbox.success) return Response.json({ error: "Choose an available mailbox." }, { status: 400 });
    try { return Response.json({ actions: await withWorkspaceViewer(viewer, () => listFollowupActions(viewer, mailbox.data)) }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return failure(error); }
  }
  let anchors: unknown;
  try { anchors = JSON.parse(params.get("anchors") || "[]"); }
  catch { return Response.json({ error: "Invalid conversation references." }, { status: 400 }); }
  const input = statusSchema.safeParse({ ...Object.fromEntries(params), anchors });
  if (!input.success) return Response.json({ error: "Choose an available mailbox message." }, { status: 400 });
  try {
    const followup = await withWorkspaceViewer(viewer, () => readFollowupStatus(viewer, input.data.mailboxId, input.data.messageId, input.data.anchors));
    return Response.json({ followup }, { headers: { "Cache-Control": "no-store", "Server-Timing": `auth;dur=${(authorizedAt - start).toFixed(1)},followup-status;dur=${(performance.now() - authorizedAt).toFixed(1)}` } });
  } catch (error) { return failure(error); }
}
const schema = z.discriminatedUnion("action", [
  statusSchema.extend({ action: z.literal("status") }),
  followupSaveSchema.safeExtend({ baseline: z.array(z.string().max(1100)).min(1).max(2000) }),
  followupContextSchema.extend({ action: z.literal("preview") }),
  z.object({ action: z.literal("cancel"), id: z.uuid(), revision: z.number().int().nonnegative() }),
]);
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const viewer = await loadViewer();
  if (viewer instanceof Response) return viewer;
  if (!viewer) return unauthenticated();
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: input.error.issues[0]?.message || "Invalid follow-up details." }, { status: 400 });
  try {
    return await withWorkspaceViewer(viewer, async () => {
      if (input.data.action === "status") return Response.json({ followup: await readFollowupStatus(viewer, input.data.mailboxId, input.data.messageId, input.data.anchors) }, { headers: { "Cache-Control": "private, no-store" } });
      if (!["admin", "operator", "bd_manager"].includes(viewer.role)) return Response.json({ error: "Your account cannot schedule follow-ups." }, { status: 403 });
      const { cancelFollowup, previewFollowup, saveFollowup, presentFollowup } = await import("@/lib/data/email-followups");
      if (input.data.action === "preview") return Response.json(await previewFollowup(viewer, input.data.mailboxId, input.data.messageId));
      const row = input.data.action === "cancel" ? await cancelFollowup(viewer, input.data.id, input.data.revision)
        : await saveFollowup(viewer, input.data, input.data.baseline);
      return Response.json({ followup: presentFollowup(row) });
    });
  } catch (error) { return failure(error); }
}
function unauthenticated() {
  return Response.json({ error: "Your session has expired. Sign in again to load follow-ups." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
}
async function loadViewer() {
  try { return await getWorkspaceViewer(); }
  catch {
    return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Unable to update this follow-up.";
  if (/email_message_followups|schema cache|does not exist/.test(message)) return Response.json({ error: "Follow-ups are unavailable until the database update is installed." }, { status: 503 });
  return Response.json({ error: message }, { status: 409 });
}
