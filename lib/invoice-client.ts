import type { InvoiceDocument } from "./invoices";

export async function invoiceRequest(
  url: string,
  body?: unknown,
  method = "PATCH",
  signal?: AbortSignal,
) {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: "no-store", signal }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
  );
  const data = await response
    .json()
    .catch(() => ({
      error: "Unexpected server response. Please sign in again or retry.",
    }));
  if (!response.ok) throw new Error(data.error ?? "Invoice request failed.");
  return data;
}
export function invoiceContextUrl(input: {
  companyId?: string | null;
  email?: string;
  threadId?: string;
}) {
  const query = new URLSearchParams({ kind: "bootstrap" });
  if (input.companyId) query.set("companyId", input.companyId);
  if (input.email) query.set("email", input.email);
  if (input.threadId) query.set("threadId", input.threadId);
  return `/api/invoices/context?${query}`;
}
export type InvoiceSeed = { document: InvoiceDocument };
