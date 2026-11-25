import { headers, cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { findPortalDomain } from "@/lib/data/portal-domain-routing";
import { withWorkspaceContext } from "@/lib/workspace-context";
import { getPublishedPortalDesign } from "@/lib/data/portal-design";
import { createSupabaseControl } from "@/lib/supabase/control";
import { portalCookie } from "@/lib/data/customer-portal";
import { portalHash } from "@/lib/customer-portal-crypto";
import { portalRequestHost } from "@/lib/portal-domains";
import { portalWebsiteDesign, publicWebsiteDesign } from "@/lib/portal-website-design";
import { PortalWebsite } from "@/components/portal-website";

export async function PortalDomainPage({ page = "home" }: { page?: string }) {
  const domain = await findPortalDomain(portalRequestHost((await headers()).get("host") || ""));
  if (!domain || domain.status !== "connected") notFound();
  const design = await withWorkspaceContext(domain.workspace_id, getPublishedPortalDesign);
  if (page !== "account") {
    const pageId = page === "home" ? "home" : page.replace(/^pages\//, "");
    if (!portalWebsiteDesign(design).pages.some(item => item.id === pageId && item.enabled)) notFound();
    return <PortalWebsite design={publicWebsiteDesign(design)} page={page} />;
  }
  // The public website never reads or serializes a customer's invoice or session.
  const token = (await cookies()).get(portalCookie)?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const { data, error } = await createSupabaseControl().from("customer_portal_sessions").select("invoice_id").eq("workspace_id", domain.workspace_id).eq("token_hash", portalHash(token)).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw new Error("Unable to check your portal session.");
    if (data) redirect(`/customer/invoices/${data.invoice_id}`);
  }
  return <main className="grid min-h-svh place-items-center bg-muted/30 p-6"><section className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm"><span className="mx-auto grid size-12 place-items-center rounded-xl bg-primary/10 text-primary"><LockKeyhole /></span><p className="mt-6 text-sm text-muted-foreground">{design.brandName}</p><h1 className="mt-2 text-2xl font-semibold">Your customer account</h1><p className="mt-4 text-sm leading-6 text-muted-foreground">Open the secure link shared by your sales team, or scan the QR code on your invoice, to view your orders, invoices, and messages.</p>{design.supportEmail && <a className="mt-6 inline-block text-sm font-medium text-primary" href={`mailto:${design.supportEmail}`}>Contact your team</a>}<Link href="/" className="mt-6 block text-sm text-muted-foreground">Back to website</Link></section></main>;
}
