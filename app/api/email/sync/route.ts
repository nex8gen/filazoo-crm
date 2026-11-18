import { requireWorkspaceMember } from "@/lib/auth";
import { getViewerMailbox, mailboxHasImap } from "@/lib/data/mailboxes";
import { enqueueMailboxSync, readMailboxSyncHealth, runMailSyncWorker, withMailSyncWorkerLease } from "@/lib/data/mail-sync-worker";
import { parseMailImportPreferences } from "@/lib/mail-import";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { validProviderFolder } from "@/lib/email-provider";
import { after } from "next/server";

export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return withWorkspaceViewer(viewer, async () => {
    const params = new URL(request.url).searchParams;
    const mailboxId = params.get("mailboxId");
    const folder = params.get("providerFolder") || "INBOX";
    if (!mailboxId || !validProviderFolder(folder)) return Response.json({ error: "Choose a mailbox and folder." }, { status: 400, headers });
    const mailbox = await getViewerMailbox(viewer.id, mailboxId);
    if (!mailbox) return Response.json({ error: "Mailbox unavailable." }, { status: 404, headers });
    try {
      const health = await readMailboxSyncHealth(mailbox, null, folder);
      return Response.json({ health, preferences: mailbox.syncPreferences, canManage: mailbox.type === "personal" ? mailbox.userId === viewer.id : viewer.role === "admin" }, { headers });
    } catch { return Response.json({ error: "Sync status is unavailable. Saved emails are still available." }, { status: 503, headers }); }
  });
}

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return withWorkspaceViewer(viewer, async () => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.mailboxId !== "string" || !["configure", "pause", "resume"].includes(body.operation)) return Response.json({ error: "Choose valid import settings." }, { status: 400, headers });
    const mailbox = await getViewerMailbox(viewer.id, body.mailboxId);
    if (!mailbox) return Response.json({ error: "Mailbox unavailable." }, { status: 404, headers });
    if (mailbox.type === "personal" ? mailbox.userId !== viewer.id : viewer.role !== "admin") return Response.json({ error: "Only the account owner or a team administrator can change import settings." }, { status: 403, headers });
    if (!mailboxHasImap(mailbox)) return Response.json({ error: "Resume and configure receiving for this connection first." }, { status: 409, headers });
    let preferences;
    try {
      preferences = parseMailImportPreferences(body.operation === "configure" ? body.preferences : { ...mailbox.syncPreferences, historyPaused: body.operation === "pause" });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid import settings." }, { status: 400, headers }); }
    let write = createSupabaseAdmin().from("workspace_mailboxes").update({ sync_preferences: preferences, updated_at: new Date().toISOString() }).eq("id", mailbox.id).eq("type", mailbox.type);
    if (mailbox.type === "personal") write = write.eq("user_id", viewer.id);
    const { data, error } = await write.select("id").maybeSingle();
    if (error || !data) return Response.json({ error: "Import settings could not be saved." }, { status: 503, headers });
    try {
      if (!preferences.historyPaused) {
        await enqueueMailboxSync({ ...mailbox, syncPreferences: preferences }, { history: true, refresh: true });
        after(() => withWorkspaceViewer(viewer, () => withMailSyncWorkerLease(() => runMailSyncWorker({ seed: false, budgetMs: 75_000, maxJobs: 8 }))));
      }
      return Response.json({ ok: true, preferences, queued: !preferences.historyPaused }, { headers });
    } catch { return Response.json({ error: "Settings were saved, but importing could not be queued. Use Save and start import to retry.", preferences }, { status: 503, headers }); }
  });
}
