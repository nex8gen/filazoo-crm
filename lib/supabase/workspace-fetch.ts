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
    return fetcher(input instanceof Request ? new Request(url, input) : url, { ...init, headers, cache: "no-store" });
  };
}
