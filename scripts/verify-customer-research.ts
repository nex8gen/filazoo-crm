import { researchCustomer } from "../lib/ai/customer-research.ts";

// Uses public company information only; never reads CRM records or changes data.
// Run: node --env-file=.env.local --experimental-strip-types scripts/verify-customer-research.ts
let providerStatus: number | undefined;
let providerIssue: string | undefined;
const result = await researchCustomer({
  identity: { name: "Prusa Research", website: "https://www.prusa3d.com", country: "Czech Republic" },
  questions: ["Research this company's public business activities and 3D printing materials. Cite official sources and say what size information is unknown."],
  apiKey: process.env.GEMINI_API_KEY?.trim(), model: process.env.GEMINI_RESEARCH_MODEL?.trim(),
  fetcher: async (input, init) => {
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(45_000) });
    providerStatus = response.status;
    if (!response.ok) {
      const error = await response.clone().json().catch(() => ({}));
      const message = String(error.error?.message || "");
      providerIssue = /location|region/i.test(message) ? "unsupported_region" : /quota|rate limit/i.test(message) ? "quota" : /API key|authentication/i.test(message) ? "authentication" : "provider_error";
    }
    return response;
  },
});
console.log(JSON.stringify({ status: result.status, providerStatus, providerIssue, sources: result.sources.map(({ id, label }) => ({ id, label })), queryCount: result.queries.length, warning: result.warning }, null, 2));
if (result.status !== "complete") process.exitCode = 1;
