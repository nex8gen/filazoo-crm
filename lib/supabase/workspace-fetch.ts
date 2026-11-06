type Scope = { workspaceId: string; userId?: string };

/** Database RLS enforces the header; this also adapts legacy upsert conflict targets. */
export function workspaceFetch(resolve: () => Promise<Scope | null>, fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.startsWith("/rest/v1/")) return fetcher(input, init);
    const scope = await resolve();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.delete("x-crm-control");
    headers.delete("x-crm-workspace-id");
    headers.delete("x-crm-user-id");
    if (scope && scope.workspaceId !== "legacy") {
      headers.set("x-crm-workspace-id", scope.workspaceId);
      if (scope.userId) headers.set("x-crm-user-id", scope.userId);
    }
    const conflict = url.searchParams.get("on_conflict");
    if (scope?.workspaceId !== "legacy" && scope && conflict && !conflict.split(",").includes("workspace_id")) url.searchParams.set("on_conflict", `workspace_id,${conflict}`);
    const options = { ...init, headers, cache: "no-store" as const };
    // Signed webhooks have no viewer. They remain in the original workspace,
    // but must use its composite keys after the database rollout. Only retry a
    // rejected conflict target: PostgreSQL has not executed that failed write.
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const legacyConflict = (!scope || scope.workspaceId === "legacy") && method.toUpperCase() === "POST"
      && conflict && !conflict.split(",").includes("workspace_id");
    const retryInput = legacyConflict && input instanceof Request ? input.clone() : input;
    const response = await fetcher(input instanceof Request ? new Request(url, input) : url, options);
    if (!legacyConflict || response.status !== 400) return response;
    const error: unknown = await response.clone().json().catch(() => null);
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "42P10") return response;
    url.searchParams.set("on_conflict", `workspace_id,${conflict}`);
    await response.body?.cancel().catch(() => {});
    return fetcher(retryInput instanceof Request ? new Request(url, retryInput) : url, options);
  };
}
