const validKey = (value, prefix) => typeof value === "string" && (value.startsWith(prefix) || value.split(".").length === 3);

export function localSupabaseConfig(environment) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey = environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY;
  const errors = [];
  try {
    if (!url || !["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
  } catch { errors.push("Set a valid NEXT_PUBLIC_SUPABASE_URL in .env.development.local."); }
  if (!validKey(publicKey, "sb_publishable_")) errors.push("Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.development.local.");
  if (!validKey(secretKey, "sb_secret_")) errors.push("Set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.development.local. Vercel does not download sensitive values.");
  return { url, publicKey, secretKey, errors };
}

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const transientCodes = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"]);

function connectionFailure(error) {
  // Node can wrap connection failures in an AggregateError (e.g. IPv4/IPv6).
  const causes = [error];
  const codes = new Set();
  for (let i = 0; i < causes.length && i < 20; i++) {
    const cause = causes[i];
    if (cause?.code) codes.add(cause.code);
    if (cause?.cause) causes.push(cause.cause);
    if (Array.isArray(cause?.errors)) causes.push(...cause.errors);
  }
  if (codes.has("EACCES") || codes.has("EPERM")) return {
    retry: false,
    message: "connection blocked by this process's network permissions. Run npm run dev from a terminal with network access.",
  };
  if (error?.name === "TimeoutError" || codes.has("ETIMEDOUT") || codes.has("UND_ERR_CONNECT_TIMEOUT") || codes.has("UND_ERR_HEADERS_TIMEOUT")) return {
    retry: true,
    message: "could not reach Supabase: the connection timed out. Check the network, VPN/proxy settings and Supabase availability, then try again.",
  };
  if (codes.has("ENOTFOUND") || codes.has("EAI_AGAIN")) return {
    retry: codes.has("EAI_AGAIN"),
    message: "could not resolve the Supabase hostname. Check NEXT_PUBLIC_SUPABASE_URL and your DNS/network connection.",
  };
  return {
    retry: [...codes].some((code) => transientCodes.has(code)),
    message: "could not reach Supabase. Check the network connection and Supabase availability, then try again.",
  };
}

// Read-only probes: validate both keys without signing anyone in or reading records.
// Retry only temporary failures; successful probes are not repeated.
export async function checkLocalSupabase(config, fetcher = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  return (await Promise.all([
    ["Authentication", "/auth/v1/settings", config.publicKey],
    ["Database", "/rest/v1/workspace_members?select=user_id&limit=0", config.secretKey],
  ].map(async ([label, path, key]) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let failure;
      try {
        const response = await fetcher(`${config.url.replace(/\/$/, "")}${path}`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
        // Do not print response bodies, URLs or keys in startup diagnostics.
        // Cleanup failures must not turn a completed HTTP check into a network failure.
        await response.body?.cancel().catch(() => {});
        if (response.ok) return null;
        failure = {
          retry: transientStatuses.has(response.status),
          message: `check failed (HTTP ${response.status}). ${[401, 403].includes(response.status) ? "Check the Supabase project URL and API keys." : "Check Supabase availability and try again."}`,
        };
      } catch (error) {
        failure = connectionFailure(error);
      }
      if (!failure.retry || attempt === 3) return `${label} ${failure.message}${attempt > 1 ? ` Failed after ${attempt} attempts.` : ""}`;
      await wait(attempt * 1000);
    }
  }))).filter(Boolean);
}
