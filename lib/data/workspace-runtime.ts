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
export async function forEachWorkspace<T>(work: (workspaceId: string, count: number) => Promise<T>, options: { rotate?: boolean; deadline?: number; throwOnError?: boolean } = {}) {
  const db = createSupabaseControl();
  const data: { id: string }[] = [];
  // PostgREST caps a single response. Every tenant must remain schedulable as we grow.
  const pageSize = 250;
  for (let offset = 0; ; offset += pageSize) {
    const { data: page, error } = await db.from("workspaces").select("id").order("created_at").order("id")
      .range(offset, offset + pageSize - 1).abortSignal(AbortSignal.timeout(15_000));
    if (!offset && (error?.code === "PGRST205" || error?.code === "42P01")) return [await work("legacy", 1)];
    if (error) throw new Error("Unable to load scheduled workspaces.");
    data.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
  }
  const results: T[] = [];
  const failures: unknown[] = [];
  if (options.rotate && data.length) {
    const offset = Math.floor(Date.now() / 60_000) % data.length;
    data.push(...data.splice(0, offset));
  }
  for (let offset = 0; offset < data.length; offset += 4) {
    if (options.deadline && Date.now() > options.deadline - 120_000) break;
    const batch = await Promise.allSettled(data.slice(offset, offset + 4).map(w => withWorkspaceContext(w.id, () => work(w.id, data.length))));
    for (const result of batch) {
      if (result.status === "fulfilled") results.push(result.value);
      else {
        failures.push(result.reason);
        console.error("Workspace background work failed; durable jobs remain queued.");
      }
    }
  }
  if (options.throwOnError && failures.length) throw new AggregateError(failures, "Unable to check every workspace.");
  return results;
}
