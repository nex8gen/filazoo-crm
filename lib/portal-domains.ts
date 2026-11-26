import { z } from "zod";
import { parse } from "tldts";
import { portalDomainStatuses } from "./portal-domain-status.ts";
export { portalDomainLabels, portalDomainStatuses } from "./portal-domain-status.ts";

export type PortalDnsRecord = { type: "TXT" | "CNAME" | "A"; name: string; value: string };
export type PortalDomain = { hostname: string; status: typeof portalDomainStatuses[number]; records: PortalDnsRecord[]; checkedAt: string | null; message: string | null };

export function normalizePortalDomain(input: string): string {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  if (!value || /[\s/:@?#\\*%]/.test(value)) throw new Error("Enter a domain only, such as portal.yourbrand.com.");
  let hostname: string;
  try { hostname = new URL(`https://${value}`).hostname; } catch { throw new Error("Enter a valid domain."); }
  const parsed = parse(hostname, { allowPrivateDomains: true });
  if (hostname.length > 253 || !parsed.domain || !parsed.isIcann || parsed.isPrivate || parsed.isIp || hostname.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("Use a public domain that you own.");
  if (["vercel.app", "vercel.com", "vercel-dns.com", "supabase.co", "supabase.com"].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) throw new Error("Use your own domain, such as portal.yourbrand.com.");
  return hostname;
}
export const portalDomainInput = z.string().max(253).transform((value, ctx) => {
  try { return normalizePortalDomain(value); } catch (error) { ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Enter a valid domain." }); return z.NEVER; }
});
export function portalRequestHost(value: string) {
  try { return new URL(`http://${value}`).hostname.toLowerCase().replace(/\.$/, ""); } catch { return ""; }
}
export function isPlatformHost(hostname: string, environment: Record<string, string | undefined> = process.env) {
  const hosts = ["localhost", "127.0.0.1", "[::1]", "crm.filazoosupply.com", "filazoo-crm.vercel.app"];
  for (const value of [environment.NEXT_PUBLIC_APP_URL, environment.VERCEL_URL, environment.VERCEL_PROJECT_PRODUCTION_URL, environment.VERCEL_BRANCH_URL]) {
    if (value) { try { hosts.push(new URL(value.includes("://") ? value : `https://${value}`).hostname); } catch {} }
  }
  return hosts.includes(hostname);
}
export function domainOwnershipRecord(hostname: string, token: string): PortalDnsRecord {
  return { type: "TXT", name: `_filazoo-portal.${hostname}`, value: `filazoo-portal-verification=${token}` };
}

export type VercelDomainConfig = { misconfigured: boolean; recommendedCNAME?: { rank: number; value: string }[]; recommendedIPv4?: { rank: number; value: string[] }[] };
export function domainRoutingRecords(hostname: string, config: VercelDomainConfig): PortalDnsRecord[] {
  const apex = parse(hostname).domain === hostname;
  const cname = [...(config.recommendedCNAME ?? [])].sort((a, b) => a.rank - b.rank)[0]?.value;
  const ips = [...(config.recommendedIPv4 ?? [])].sort((a, b) => a.rank - b.rank)[0]?.value ?? [];
  if (!apex && cname) return [{ type: "CNAME", name: hostname, value: cname.replace(/\.$/, "") }];
  return ips.slice(0, 1).map(value => ({ type: "A", name: hostname, value }));
}
/** Only public IPv4 destinations may be used by the bounded certificate probe. */
export function publicPortalAddress(ip: string) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const [a, b, c, d] = ip.split(".").map(Number);
  return [a, b, c, d].every(n => n <= 255) && a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
}
