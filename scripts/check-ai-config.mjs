// Reports credential presence only; never prints secrets.
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true);
console.log(JSON.stringify({ provider: "vercel-ai-gateway", apiKey: Boolean(process.env.AI_GATEWAY_API_KEY), oidc: Boolean(process.env.VERCEL_OIDC_TOKEN), oidcExpired: (() => {
  try { return JSON.parse(Buffer.from(process.env.VERCEL_OIDC_TOKEN.split(".")[1], "base64url").toString()).exp * 1000 < Date.now(); } catch { return null; }
})() }));
