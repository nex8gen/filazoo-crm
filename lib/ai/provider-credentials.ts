import { getVercelOidcToken, getVercelOidcTokenSync } from "@vercel/oidc";

function expired(token: string) {
  try {
    if (token.split(".").length === 3) {
      const expiry: unknown = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp;
      return typeof expiry === "number" && expiry * 1000 <= Date.now();
    }
  } catch { /* Opaque API keys do not carry JWT expiry claims. */ }
  return false;
}

let localRefresh: Promise<string> | undefined;

/** The async SDK renews local OIDC using the existing CLI login. Production
 * always uses its own request identity and never reads local CLI credentials. */
export async function resolveGatewayTokenAsync(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const token = resolveGatewayToken(env);
  if (token && !expired(token)) return token;
  if (!token) return undefined;
  if (env !== process.env || env.NODE_ENV === "production" && env.FILAZOO_STABLE_RUNTIME !== "1" || env.VERCEL === "1") return token;
  if (!localRefresh) localRefresh = (async () => {
    let project = env.VERCEL_PROJECT_ID, team = env.VERCEL_ORG_ID;
    if (!project || !team) {
      try {
        const { readFile } = await import("node:fs/promises");
        const repo = JSON.parse(await readFile(`${process.cwd()}/.vercel/repo.json`, "utf8"));
        const root = repo.projects?.find((entry: { directory: string }) => entry.directory === ".");
        project ??= root?.id; team ??= root?.orgId;
      } catch { /* The SDK can also resolve an ordinary .vercel/project.json. */ }
    }
    try { return await getVercelOidcToken({ project, team }); }
    catch { throw new Error("AI Gateway credentials could not be refreshed. Restore the linked project's Vercel login or configure an AI Gateway API key."); }
  })().finally(() => { localRefresh = undefined; });
  return localRefresh;
}

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
  const token = resolveGatewayToken(env);
  if (!token) return false;
  return !expired(token);
}
