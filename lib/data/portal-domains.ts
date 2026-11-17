import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { connect } from "node:tls";
import { createSupabaseAdmin } from "../supabase/admin";
import { domainOwnershipRecord, domainRoutingRecords, isPlatformHost, normalizePortalDomain, publicPortalAddress, type PortalDnsRecord, type PortalDomain } from "../portal-domains";
import { addProviderDomain, getProviderConfig, getProviderDomain, portalDomainHostingReady, providerOwnershipRecords, removeProviderDomain, verifyProviderDomain } from "../portal-domain-provider";

type Row = { hostname: string; status: PortalDomain["status"]; verification_token: string; records: PortalDnsRecord[]; provider_added: boolean; checked_at: string | null; message: string | null; operation_token: string | null };
function publicView(row: Row): PortalDomain { return { hostname: row.hostname, status: row.status, records: row.records, checkedAt: row.checked_at, message: row.message }; }
async function readDomain() {
  const { data, error } = await createSupabaseAdmin().from("workspace_portal_domains").select("*").maybeSingle();
  if (error) throw new Error("Unable to load domain settings. Check that the portal domain migration is installed.");
  return data as Row | null;
}
export async function portalDomainSettings() {
  const row = await readDomain();
  return { domain: row ? publicView(row) : null, hostingReady: portalDomainHostingReady() };
}
export async function connectPortalDomain(value: string) {
  if (!portalDomainHostingReady()) throw new Error("Custom domain hosting has not been enabled for this installation yet.");
  const hostname = normalizePortalDomain(value);
  if (isPlatformHost(hostname)) throw new Error("This address is already used by the CRM. Choose a different domain or subdomain.");
  if (await readDomain()) throw new Error("Disconnect your current portal domain before adding another.");
  if (await getProviderDomain(hostname)) throw new Error("This address is already assigned to this installation. Choose a different domain or subdomain.");
  const config = await getProviderConfig(hostname);
  const token = randomBytes(24).toString("hex");
  const records = [domainOwnershipRecord(hostname, token), ...domainRoutingRecords(hostname, config)];
  if (records.length < 2) throw new Error("The hosting provider could not supply DNS records. Please try again.");
  const { data, error } = await createSupabaseAdmin().from("workspace_portal_domains").insert({ hostname, verification_token: token, records }).select("*").single();
  if (error?.code === "23505") throw new Error("This domain is already being connected. Refresh your settings or choose a different domain.");
  if (error) throw new Error("Unable to save this portal domain.");
  return publicView(data as Row);
}
async function domainLease() {
  const token = randomUUID();
  const { data, error } = await createSupabaseAdmin().from("workspace_portal_domains").update({ operation_token: token, operation_until: new Date(Date.now() + 120_000).toISOString() }).or(`operation_until.is.null,operation_until.lt.${new Date().toISOString()}`).select("*").maybeSingle();
  if (error) throw new Error("Unable to update this portal domain.");
  if (!data) throw new Error("A domain operation is already in progress, or the domain was removed. Please retry shortly.");
  return { row: data as Row, token };
}
async function updateDomain(hostname: string, token: string, patch: Record<string, unknown>) {
  const { data, error } = await createSupabaseAdmin().from("workspace_portal_domains").update(patch).eq("hostname", hostname).eq("operation_token", token).select("*").maybeSingle();
  if (error || !data) throw new Error("Domain settings changed during this operation. Refresh and try again.");
  return data as Row;
}
async function releaseDomain(hostname: string, token: string) {
  const { error } = await createSupabaseAdmin().from("workspace_portal_domains").update({ operation_token: null, operation_until: null }).eq("hostname", hostname).eq("operation_token", token);
  if (error) console.error("Unable to release portal domain operation", error.code);
}
export async function portalDomainHasOwnership(hostname: string, token: string) {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  try { return (await resolver.resolveTxt(`_filazoo-portal.${hostname}`)).some(parts => parts.join("") === domainOwnershipRecord(hostname, token).value); }
  catch { return false; }
}
export async function portalCertificateReady(hostname: string) {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  let addresses: string[];
  try { addresses = await resolver.resolve4(hostname); } catch { return false; }
  if (!addresses.length || !addresses.every(publicPortalAddress)) return false;
  return new Promise<boolean>(resolve => {
    // Pin the resolved public address, validate the certificate against the
    // hostname, and send no HTTP request or customer data to the destination.
    const socket = connect({ host: addresses[0], port: 443, servername: hostname, rejectUnauthorized: true });
    const done = (ready: boolean) => { socket.destroy(); resolve(ready); };
    socket.setTimeout(5000, () => done(false));
    socket.once("error", () => done(false));
    socket.once("secureConnect", () => done(socket.authorized));
  });
}
export async function verifyPortalDomain() {
  const { row, token } = await domainLease();
  try {
    if (row.status === "disconnecting") throw new Error("Finish disconnecting this domain before verifying it.");
    const checked_at = new Date().toISOString();
    if (!await portalDomainHasOwnership(row.hostname, row.verification_token)) return publicView(await updateDomain(row.hostname, token, { status: "pending_dns", checked_at, message: "The ownership TXT record was not found yet. Add the records below, keep them in place, and check again after DNS updates." }));
    let domain = await getProviderDomain(row.hostname);
    if (!row.provider_added) await updateDomain(row.hostname, token, { provider_added: true });
    domain ??= await addProviderDomain(row.hostname);
    if (!domain.verified) {
      try { domain = await verifyProviderDomain(row.hostname); }
      catch { domain = await getProviderDomain(row.hostname) ?? domain; }
    }
    const config = await getProviderConfig(row.hostname);
    const records = [domainOwnershipRecord(row.hostname, row.verification_token), ...domainRoutingRecords(row.hostname, config), ...providerOwnershipRecords(domain)];
    const dnsReady = domain.verified === true && config.misconfigured === false;
    const ready = dnsReady && await portalCertificateReady(row.hostname);
    return publicView(await updateDomain(row.hostname, token, { status: ready ? "connected" : dnsReady ? "pending_ssl" : "pending_dns", records, checked_at, message: ready ? null : dnsReady ? "DNS is verified. Your HTTPS certificate is still being prepared. Check again shortly." : "Keep all required DNS records in place, then check again. DNS updates may take up to 48 hours." }));
  } finally { await releaseDomain(row.hostname, token); }
}
export async function disconnectPortalDomain() {
  const { row, token } = await domainLease();
  try {
    await updateDomain(row.hostname, token, { status: "disconnecting", message: "This domain is being disconnected. Retry disconnect if it does not finish." });
    if (row.provider_added) await removeProviderDomain(row.hostname);
    const { error } = await createSupabaseAdmin().from("workspace_portal_domains").delete().eq("hostname", row.hostname).eq("operation_token", token);
    if (error) throw new Error("Unable to finish disconnecting this domain. Please retry.");
  } finally { await releaseDomain(row.hostname, token); }
}
