import { z } from "zod";
import { emailDesignSchema, emailDesignText, type EmailDesign } from "./email-design.ts";

export const DOCUMENT_BUCKET = "workspace-documents";
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const documentCategories = [
  { id: "quotation", label: "Quotations", group: "Business documents" },
  { id: "proforma", label: "Draft invoices", group: "Business documents" },
  { id: "invoice", label: "Commercial invoices", group: "Business documents" },
  { id: "purchase_order", label: "Customer purchase orders", group: "Business documents" },
  { id: "payment", label: "Payment receipts", group: "Business documents" },
  { id: "catalog", label: "Product catalogs", group: "Shared resources" },
  { id: "datasheet", label: "TDS / SDS", group: "Shared resources" },
  { id: "certificate", label: "Certificates & qualifications", group: "Shared resources" },
  { id: "policy", label: "Company documents", group: "Shared resources" },
  { id: "promotion", label: "Email library", group: "Email templates" },
  { id: "everyday", label: "Custom emails", group: "Email templates" },
  { id: "general", label: "Other files", group: "Shared resources" },
] as const;
export type DocumentCategory = typeof documentCategories[number]["id"];
export const documentCategorySchema = z.enum(documentCategories.map(category => category.id));
export type LibraryFolder = { id: string; name: string; color: string };
export type LibraryDocument = {
  id: string; name: string; kind: "file" | "template"; mime_type: string; size: number;
  folder_id: string | null; company: string; tags: string[]; description: string;
  subject: string; body: string; created_at: string; updated_at: string;
  deleted_at: string | null; starred: boolean;
  category: DocumentCategory; related_ids: string[];
  source_type?: "quotation" | "invoice" | "purchase_order" | "payment" | null;
  source_id?: string | null; source_status?: string;
  company_id?: string | null; purchase_order_id?: string | null; invoice_id?: string | null; product_skus?: string[];
  search_text?: string;
  design_version?: string | null; email_design?: EmailDesign | null;
  origin?: "builtin" | "workspace";
  preview_url?: string;
};
export type LibrarySnapshot = { documents: LibraryDocument[]; folders: LibraryFolder[]; stats: LibraryResult["stats"] };
export type LibraryResult = {
  documents: LibraryDocument[]; folders: LibraryFolder[]; total: number;
  stats: { files: number; templates: number; starred: number; trash: number };
  collection?: LibrarySnapshot | null;
};
export const documentMetadataSchema = z.object({
  name: z.string().trim().min(1, "Give this item a name.").max(200),
  folder_id: z.uuid().nullable().default(null),
  company: z.string().trim().max(160).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  description: z.string().trim().max(2000).default(""),
  category: documentCategorySchema.default("general"),
  related_ids: z.array(z.uuid()).max(10).default([]),
  company_id: z.uuid().nullable().default(null),
  purchase_order_id: z.uuid().nullable().default(null),
  invoice_id: z.uuid().nullable().default(null),
  product_skus: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
});
export const documentInputSchema = documentMetadataSchema.extend({
  id: z.uuid(), kind: z.enum(["file", "template"]),
  subject: z.string().trim().max(300).default(""),
  body: z.string().max(12000).default(""),
  email_design: emailDesignSchema.nullable().optional(),
}).superRefine((value, context) => {
  if (value.email_design && emailDesignText(value.email_design).length > 12000) context.addIssue({ code: "custom", path: ["email_design"], message: "Keep the email text under 12,000 characters." });
  if (value.kind === "template" && !value.body.trim()) context.addIssue({ code: "custom", path: ["body"], message: "Add some text to your template." });
  if (value.kind === "file" && value.email_design) context.addIssue({ code: "custom", path: ["email_design"], message: "Email designs belong to templates." });
  const emailCategory = ["promotion", "everyday"].includes(value.category);
  if ((value.kind === "file" && emailCategory) || (value.kind === "template" && !emailCategory && value.category !== "general")) context.addIssue({ code: "custom", path: ["category"], message: "Choose a category that matches the file or text template." });
}).transform(value => ({ ...value, category: value.kind === "template" ? "everyday" as const : value.category }));
export const folderInputSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.enum(["green", "blue", "amber", "purple"]).default("green") });

export function isBuiltinEmailTemplate(document: Pick<LibraryDocument, "origin">) { return document.origin === "builtin"; }

/** Legacy workspace templates used both email categories; all are custom emails. */
export function workspaceLibraryDocument(document: LibraryDocument): LibraryDocument {
  return { ...document, origin: "workspace", category: document.kind === "template" ? "everyday" : document.category };
}

export function documentSearchText(value: { name: string; company: string; description: string; tags: string[]; subject: string; body: string; product_skus?: string[] }) {
  return [value.name, value.company, value.description, ...value.tags, value.subject, value.body, ...(value.product_skus ?? [])].join(" ").toLowerCase();
}
export function documentType(document: Pick<LibraryDocument, "name" | "kind" | "mime_type">) {
  if (document.kind === "template") return "template";
  if (document.mime_type.startsWith("image/")) return "image";
  if (/\.(xlsx?|csv|ods)$/i.test(document.name)) return "spreadsheet";
  if (document.mime_type === "application/pdf") return "pdf";
  if (/\.(docx?|txt|md|rtf|odt)$/i.test(document.name)) return "document";
  return "file";
}
export function formatDocumentSize(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function escapeDocumentSearch(query: string) { return query.replace(/[\\%_]/g, "\\$&"); }
export function canPreviewDocument(mime: string) {
  return ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(mime);
}
