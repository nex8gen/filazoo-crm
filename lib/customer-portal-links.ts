import "server-only";
import { env } from "./env";
import { invoicePortalKey } from "./customer-portal-crypto";
import type { Invoice } from "./invoices";

export function customerPortalSecret() {
  const secret = process.env.CUSTOMER_PORTAL_SECRET || env.supabaseSecretKey;
  if (!secret) throw new Error("Customer portal signing is not configured.");
  return secret;
}
export function customerPortalUrl(invoice: Invoice) {
  // Print the final link on saved drafts too. The session endpoint keeps draft
  // details private until issue; issuing does not change this QR credential.
  if (!invoice.document.customerEmail.trim()) return undefined;
  const configured = process.env.NEXT_PUBLIC_APP_URL || "https://crm.filazoosupply.com";
  const origin = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(configured) ? "https://crm.filazoosupply.com" : configured;
  const url = new URL(`/customer/invoices/${invoice.id}`, origin);
  // A fragment keeps the credential out of HTTP access logs and referrer headers.
  url.hash = `key=${invoicePortalKey(invoice.id, invoice.document.customerEmail, customerPortalSecret())}`;
  return url.href;
}
