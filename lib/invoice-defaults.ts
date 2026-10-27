import { z } from "zod";
import { blankInvoiceDocument, invoiceCurrencies } from "./invoices.ts";
import { sellerSettingsSchema } from "./invoice-links.ts";

export const invoiceDefaultsSchema = z.object({
  currency: z.enum(invoiceCurrencies).default("USD"),
  termsDays: z.number().int().min(0).max(365).default(0),
  taxBps: z.number().int().min(0).max(10000).default(0),
});
export type InvoiceDefaults = z.infer<typeof invoiceDefaultsSchema>;

export function invoiceDocumentWithDefaults(today: string, settings: Record<string, unknown>) {
  const defaults = invoiceDefaultsSchema.parse(settings.defaults ?? {});
  const document = {
    ...blankInvoiceDocument(today),
    ...sellerSettingsSchema.partial().parse(settings),
    currency: defaults.currency,
  };
  const due = new Date(`${today}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + defaults.termsDays);
  document.dueDate = due.toISOString().slice(0, 10);
  document.items = document.items.map((item) => ({ ...item, taxBps: defaults.taxBps }));
  return document;
}

export function readInvoiceDefaults(settings: Record<string, unknown>) {
  const document = invoiceDocumentWithDefaults("2000-01-01", settings);
  return { seller: sellerSettingsSchema.parse(document), defaults: invoiceDefaultsSchema.parse(settings.defaults ?? {}) };
}
export type InvoiceDefaultsSettings = ReturnType<typeof readInvoiceDefaults>;
