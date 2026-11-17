import "server-only";
import type { PortalDnsRecord, VercelDomainConfig } from "./portal-domains";

export type ProviderDomain = { name: string; verified: boolean; verification?: { type: string; domain: string; value: string }[] };
export function portalDomainHostingReady() { return Boolean(process.env.PORTAL_VERCEL_TOKEN && (process.env.PORTAL_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID)); }
export class DomainProviderError extends Error { constructor(message: string, public status: number) { super(message); } }
async function vercelRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (!portalDomainHostingReady()) throw new Error("Custom domain hosting has not been enabled for this installation yet.");
  const url = new URL(path, "https://api.vercel.com");
  const team = process.env.PORTAL_VERCEL_TEAM_ID || process.env.VERCEL_TEAM_ID;
  if (team) url.searchParams.set("teamId", team);
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${process.env.PORTAL_VERCEL_TOKEN}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "error" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new DomainProviderError(response.status === 401 || response.status === 403 ? "Domain hosting authorization needs attention. Contact the installation administrator." : data?.error?.message || "The hosting provider could not complete this request.", response.status);
  return data as T;
}
function projectPath(version = "v9") { return `/${version}/projects/${encodeURIComponent(process.env.PORTAL_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID || "")}/domains`; }
export async function getProviderDomain(hostname: string) {
  try { return await vercelRequest<ProviderDomain>(`${projectPath()}/${encodeURIComponent(hostname)}`); }
  catch (error) { if (error instanceof DomainProviderError && error.status === 404) return null; throw error; }
}
export function addProviderDomain(hostname: string) { return vercelRequest<ProviderDomain>(projectPath("v10"), "POST", { name: hostname }); }
export function verifyProviderDomain(hostname: string) { return vercelRequest<ProviderDomain>(`${projectPath()}/${encodeURIComponent(hostname)}/verify`, "POST"); }
export function getProviderConfig(hostname: string) { return vercelRequest<VercelDomainConfig>(`/v6/domains/${encodeURIComponent(hostname)}/config?projectIdOrName=${encodeURIComponent(process.env.PORTAL_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID || "")}`); }
export async function removeProviderDomain(hostname: string) {
  try { await vercelRequest(`${projectPath()}/${encodeURIComponent(hostname)}`, "DELETE"); }
  catch (error) { if (!(error instanceof DomainProviderError && error.status === 404)) throw error; }
}
export function providerOwnershipRecords(domain: ProviderDomain): PortalDnsRecord[] {
  return (domain.verification ?? []).filter(record => record.type === "TXT").map(record => ({ type: "TXT", name: record.domain, value: record.value }));
}
