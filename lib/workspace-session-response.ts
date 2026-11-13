/** This marker is emitted only before any request body, saved turn or CRM action runs. */
export const workspaceSessionRetryCode = "WORKSPACE_SESSION_UNAVAILABLE";

export function workspaceSessionUnavailableResponse() {
  return Response.json({ error: "Unable to verify your workspace session. Please retry.", code: workspaceSessionRetryCode, retryable: true, executionStarted: false }, {
    status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "1" },
  });
}

export function isWorkspaceSessionRetry(response: Pick<Response, "status">, body: unknown) {
  if (!body || typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  return response.status === 503 && value.code === workspaceSessionRetryCode && value.retryable === true && value.executionStarted === false;
}
