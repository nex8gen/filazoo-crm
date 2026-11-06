import { getVercelOidcTokenSync } from "@vercel/oidc";

/** Resolve inside each request: production OIDC is in Vercel's trusted request
 * context, not necessarily in process.env. Never cache a request's identity. */
export function resolveGatewayToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (apiKey) return apiKey;
  try {
    return getVercelOidcTokenSync().trim() || undefined;
  } catch {
    // Standalone workers and local development can use a pulled OIDC token.
    return env.VERCEL_OIDC_TOKEN?.trim() || undefined;
  }
}

export function hasAiProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  if (resolveGatewayToken(env)) return true;
  // Keep legacy deployments on their selected provider; this flag no longer
  // enables application allowance checks in any generation path.
  if (env.AI_PROVIDER === "gateway" || env.AI_BUDGET_ENFORCEMENT === "true") return false;
  return Boolean(env.GEMINI_API_KEY?.trim());
}
