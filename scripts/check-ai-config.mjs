// Reports source/shape only. Never prints credentials.
import nextEnv from "@next/env";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
const describe = (value) => ({ present: Boolean(value), length: value?.length || 0,
  placeholder: /^(?:\[SENSITIVE\]|your[-_].*|intercepted.*|placeholder)$/i.test(value || ""),
  googleKeyShape: /^(?:AIza[A-Za-z0-9_-]{35}|AQ\.[A-Za-z0-9_.-]+)$/.test(value || ""),
  containsAssignment: /^GEMINI_API_KEY\s*=/.test(value || ""),
  configurationMarker: /vercel|production|configure|redact|secret|sensitive|placeholder/i.test(value || ""),
  keyFamily: value?.startsWith("AIza") ? "google-standard" : value?.startsWith("AQ.") ? "google-auth" : value?.startsWith("vck_") ? "vercel" : value?.startsWith("sb_") ? "supabase" : "other",
  embeddedGoogleKey: /AIza[A-Za-z0-9_-]{35}/.test(value || ""),
  surroundingWhitespace: value !== value?.trim(),
  invalidHeaderCharacters: /[\s"'`=\\]/.test(value || ""),
  assignmentValueIsGoogleKey: /^AIza[A-Za-z0-9_-]{35}$/.test((value || "").replace(/^GEMINI_API_KEY\s*=\s*/, "").trim().replace(/^["']|["']$/g, "")),
  fingerprint: value ? createHash("sha256").update(value).digest("hex").slice(0, 12) : null });
for (const name of readdirSync(".").filter((name) => /^\.env(?:\.|$)/.test(name))) {
  const line = readFileSync(name, "utf8").split(/\r?\n/).find((line) => line.startsWith("GEMINI_API_KEY="));
  if (line) console.log(name, JSON.stringify(describe(line.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, ""))));
}
console.log("Inherited Gemini", JSON.stringify(describe(process.env.GEMINI_API_KEY)));
nextEnv.loadEnvConfig(process.cwd(), true);
console.log("Next.js resolved Gemini", JSON.stringify(describe(process.env.GEMINI_API_KEY)));
console.log("Gateway credentials", JSON.stringify({ apiKey: Boolean(process.env.AI_GATEWAY_API_KEY), oidc: Boolean(process.env.VERCEL_OIDC_TOKEN), oidcExpired: (() => {
  try { return JSON.parse(Buffer.from(process.env.VERCEL_OIDC_TOKEN.split(".")[1], "base64url").toString()).exp * 1000 < Date.now(); } catch { return null; }
})() }));
