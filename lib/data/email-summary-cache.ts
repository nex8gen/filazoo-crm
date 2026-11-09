import { randomUUID } from "node:crypto";
import type { WorkspaceViewer } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import { reuseEmailSummary, type SavedEmailSummary, type EmailSummaryStore } from "../ai/email-summary-cache.ts";

const pending = new Map<string, Promise<SavedEmailSummary>>();

export function savedEmailSummary(viewer: WorkspaceViewer, key: string, generate: () => Promise<string>, refresh = false) {
  const scope = `${viewer.workspaceId}:${viewer.id}:${key}`;
  const existing = pending.get(scope);
  if (existing) return existing.then(result => ({ ...result, cached: true }));
  const work = withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin();
    const row = () => db.from("email_summary_cache");
    const store: EmailSummaryStore = {
      read: async () => {
        const { data, error } = await row().select("output,generated_at").eq("user_id", viewer.id).eq("input_hash", key).maybeSingle();
        if (error) throw new Error("Unable to load saved email analysis. Check the email summary cache migration before retrying.");
        return data ? { output: data.output as string | null, generatedAt: data.generated_at as string | null } : null;
      },
      claim: async token => {
        await row().upsert({ user_id: viewer.id, input_hash: key }, { onConflict: "user_id,input_hash", ignoreDuplicates: true }).throwOnError();
        const now = new Date();
        const { data } = await row().update({ lease_token: token, lease_until: new Date(now.getTime() + 130_000).toISOString() }).eq("user_id", viewer.id).eq("input_hash", key)
          .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select("input_hash").maybeSingle().throwOnError();
        return Boolean(data);
      },
      complete: async (token, output, generatedAt) => {
        const { data } = await row().update({ output, generated_at: generatedAt }).eq("user_id", viewer.id).eq("input_hash", key).eq("lease_token", token).select("input_hash").maybeSingle().throwOnError();
        if (!data) throw new Error("The email analysis lease expired. Please reload the saved analysis.");
      },
      release: async token => {
        await row().update({ lease_token: null, lease_until: null }).eq("user_id", viewer.id).eq("input_hash", key).eq("lease_token", token).throwOnError();
      },
    };
    return reuseEmailSummary(store, randomUUID(), generate, refresh);
  });
  pending.set(scope, work);
  void work.finally(() => { if (pending.get(scope) === work) pending.delete(scope); }).catch(() => {});
  return work;
}
