import { cache } from "react";
import { getWorkspaceViewer } from "../auth.ts";
import { createSupabaseControl } from "../supabase/control.ts";
import { currentWorkspaceContext, withWorkspaceContext } from "../workspace-context.ts";

/** Environment integrations belong exclusively to the original workspace. */
export const hasLegacyIntegrations = cache(async () => {
  const context = currentWorkspaceContext();
  const id = context?.workspaceId ?? (await getWorkspaceViewer())?.workspaceId;
  if (!id || id === "legacy") return true; // Signed webhooks and legacy jobs have their own authorization.
  const { data, error } = await createSupabaseControl().from("workspaces").select("is_legacy").eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to verify workspace integration access.");
  return data?.is_legacy === true;
});

/** Invoke only after authenticating the scheduler. Each callback gets independent tenant RLS. */
export async function forEachWorkspace<T>(work: (workspaceId: string, count: number) => Promise<T>, options: { rotate?: boolean; deadline?: number } = {}) {
  const { data, error } = await createSupabaseControl().from("workspaces").select("id").order("created_at");
  if (error?.code === "PGRST205" || error?.code === "42P01") return [await work("legacy", 1)];
  if (error) throw new Error("Unable to load scheduled workspaces.");
  const results: T[] = [];
  if (options.rotate && data?.length) {
    const offset = Math.floor(Date.now() / 60_000) % data.length;
    data.push(...data.splice(0, offset));
  }
  for (let offset = 0; offset < (data?.length ?? 0); offset += 4) {
    if (options.deadline && Date.now() > options.deadline - 120_000) break;
    const batch = await Promise.allSettled(data!.slice(offset, offset + 4).map(w => withWorkspaceContext(w.id, () => work(w.id, data!.length))));
    for (const result of batch) {
      if (result.status === "fulfilled") results.push(result.value);
      else console.error("Workspace background work failed; durable jobs remain queued.");
    }
  }
  return results;
}
