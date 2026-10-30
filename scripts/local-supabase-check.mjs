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

// Read-only probes: validate both keys without signing anyone in or reading records.
export async function checkLocalSupabase(config, fetcher = fetch) {
  return (await Promise.all([
    ["Authentication", "/auth/v1/settings", config.publicKey],
    ["Database", "/rest/v1/workspace_members?select=user_id&limit=0", config.secretKey],
  ].map(async ([label, path, key]) => {
    try {
      const response = await fetcher(`${config.url.replace(/\/$/, "")}${path}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      // Do not print response bodies, URLs or keys in startup diagnostics.
      await response.body?.cancel();
      if (!response.ok) return `${label} check failed (HTTP ${response.status}). ${[401, 403].includes(response.status) ? "Check the Supabase project URL and API keys." : "Check Supabase availability and try again."}`;
    } catch (error) {
      const code = error?.cause?.code || error?.code;
      if (code === "EACCES" || code === "EPERM") return `${label} connection blocked by this process's network permissions. Run npm run dev from a terminal with network access.`;
      return `${label} could not reach Supabase. Check the network connection and Supabase availability, then try again.`;
    }
    return null;
  }))).filter(Boolean);
}
