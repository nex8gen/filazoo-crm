import { z } from "zod";

const tone = z.enum(["neutral", "success", "warning", "danger"]);
const cell = z.union([z.string().max(400), z.number().finite(), z.null()]);
export const responsePresentationSchema = z.object({
  version: z.literal(1),
  capturedAt: z.iso.datetime(),
  sections: z.array(z.object({
    id: z.enum(["invoices", "orders", "quotations", "companies", "tasks", "products", "inventory", "segments"]),
    title: z.string().max(120),
    description: z.string().max(600),
    columns: z.array(z.object({ key: z.string().max(40), label: z.string().max(80) })).min(1).max(8),
    rows: z.array(z.object({
      id: z.string().min(1).max(200), title: z.string().max(200), subtitle: z.string().max(240),
      href: z.string().regex(/^\/(?:tasks$|(?:invoices|purchase-orders|company-quotations|companies|products)\/[A-Za-z0-9%._~-]+$)/).optional(),
      status: z.string().max(80), tone,
      cells: z.record(z.string().max(40), cell),
    })).max(50),
    metrics: z.array(z.object({ label: z.string().max(80), value: z.string().max(100), tone })).max(8),
    chart: z.object({
      kind: z.enum(["bar", "line"]).default("bar"),
      title: z.string().max(120),
      points: z.array(z.object({ label: z.string().max(120), value: z.number().finite().nonnegative() })).min(2).max(20),
      unit: z.string().max(30),
    }).optional(),
    emptyMessage: z.string().max(240),
  })).min(1).max(3),
});
export type ResponsePresentation = z.infer<typeof responsePresentationSchema>;
export type ResponseSection = ResponsePresentation["sections"][number];

export const recordPreviewRequestSchema = z.object({ records: z.array(z.object({
  resource: z.enum(["invoices", "orders", "quotations", "companies"]), id: z.uuid(),
}).strict()).min(1).max(10) }).strict();

export function referencedRecords(text: string): z.infer<typeof recordPreviewRequestSchema>["records"] {
  const resources = { invoices: "invoices", "purchase-orders": "orders", "company-quotations": "quotations", companies: "companies" } as const;
  const records = new Map<string, z.infer<typeof recordPreviewRequestSchema>["records"][number]>();
  for (const match of text.matchAll(/\/(invoices|purchase-orders|company-quotations|companies)\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})(?![a-z\d-])/gi)) {
    const resource = resources[match[1].toLowerCase() as keyof typeof resources], id = match[2].toLowerCase();
    if (z.uuid().safeParse(id).success) records.set(`${resource}:${id}`, { resource, id });
    if (records.size === 10) break;
  }
  return [...records.values()];
}

export function parseResponsePresentation(value: unknown): ResponsePresentation | undefined {
  const result = responsePresentationSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Quotes, delimiters and newlines are escaped; spreadsheet formula prefixes stay text. */
export function presentationCsv(section: ResponseSection) {
  function escape(value: unknown) {
    const text = value == null ? "" : String(value);
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) && typeof value !== "number" ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return "\uFEFF" + [section.columns.map(column => escape(column.label)).join(","), ...section.rows.map(row => section.columns.map(column => escape(row.cells[column.key])).join(","))].join("\r\n");
}
