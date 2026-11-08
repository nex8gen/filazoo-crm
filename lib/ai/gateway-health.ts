import { resolveGatewayTokenAsync } from "./provider-credentials.ts";

/** Authenticated, read-only probe. Does not generate content or spend credits. */
export async function verifyGatewayAccess(options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}) {
  const token = await resolveGatewayTokenAsync();
  if (!token) throw new Error("AI credentials are missing. Restore the Vercel login or configure an AI Gateway key.");
  const signal = AbortSignal.any([AbortSignal.timeout(5_000), ...(options.signal ? [options.signal] : [])]);
  const response = await (options.fetcher ?? fetch)("https://ai-gateway.vercel.sh/v1/credits", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
  if (!response.ok) throw new Error(`AI Gateway rejected its live access check (HTTP ${response.status}). Review authentication, billing, and team access.`);
  const result = await response.json();
  if (result.balance !== undefined && Number.isFinite(Number(result.balance)) && Number(result.balance) <= 0) throw new Error("AI Gateway has no available credits. Review billing before running AI actions.");
}
