import { AsyncLocalStorage } from "node:async_hooks";
import { workspaceIdSchema } from "./workspaces.ts";
import type { WorkspaceViewer } from "./auth.ts";

type WorkspaceContext = { workspaceId: string; userId?: string };
const context = new AsyncLocalStorage<WorkspaceContext>();

/** For trusted jobs and capability-validated customer requests. Never take an unchecked client ID. */
export function withWorkspaceContext<T>(workspaceId: string, work: () => T, userId?: string): T {
  return context.run({ workspaceId: workspaceIdSchema.parse(workspaceId), userId }, work);
}

export function currentWorkspaceContext() { return context.getStore(); }

/** Bind an already authenticated viewer to this request only. This scopes data
 * clients without re-running the same session lookup for every database client.
 * Authentication and role checks remain at each request/action boundary.
 */
export function withWorkspaceViewer<T>(viewer: Pick<WorkspaceViewer, "workspaceId" | "id">, work: () => T): T {
  const workspaceId = viewer.workspaceId === "legacy" ? "legacy" : workspaceIdSchema.parse(viewer.workspaceId);
  return context.run({ workspaceId, userId: viewer.id }, work);
}
