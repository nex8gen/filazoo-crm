import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { defaultPortalDesign, portalDesignSchema, portalFeatureAllowed, portalAccentForeground, canManagePortal } from "../lib/portal-design.ts";
import { portalPreviewData } from "../lib/portal-preview.ts";

test("portal designs validate text, branding, section identity and executable URLs", () => {
  const design = defaultPortalDesign();
  assert.equal(portalDesignSchema.safeParse(design).success, true);
  for (const logoUrl of ["javascript:alert(1)", "data:image/svg+xml,test", "http://example.com/logo.png", "/image.png"]) {
    assert.equal(portalDesignSchema.safeParse({ ...design, logoUrl }).success, false);
  }
  assert.equal(portalDesignSchema.safeParse({ ...design, logoUrl: "https://example.com/logo.png" }).success, true);
  assert.equal(portalDesignSchema.safeParse({ ...design, heading: "", welcome: "" }).success, true);
  for (const patch of [{ brandName: " " }, { accent: "red;display:none" }, { supportEmail: "not-an-email" }, { announcement: "a".repeat(301) }, { arbitraryHtml: "<script>" }]) {
    assert.equal(portalDesignSchema.safeParse({ ...design, ...patch }).success, false);
  }
  assert.equal(portalDesignSchema.safeParse({ ...design, sections: [...design.sections, design.sections[0]] }).success, false);
  assert.equal(portalDesignSchema.safeParse({ ...design, sections: design.sections.slice(1) }).success, false);
  assert.equal(portalDesignSchema.safeParse({ ...design, sections: design.sections.map(s => ({ ...s, enabled: false })) }).success, true);
});

test("hidden portal sections are redacted before reaching the customer browser", () => {
  const design = defaultPortalDesign();
  const visible = portalPreviewData(design);
  assert.ok(visible.invoice); assert.ok(visible.overview); assert.ok(visible.shipment); assert.ok(visible.order); assert.equal(visible.messages.length, 1);
  design.sections.forEach(section => { section.enabled = false; });
  const hidden = portalPreviewData(design);
  assert.equal(hidden.invoice, null); assert.equal(hidden.overview, null); assert.equal(hidden.shipment, null); assert.equal(hidden.order, null); assert.deepEqual(hidden.messages, []);
  const serialized = JSON.stringify(hidden);
  for (const secret of ["DEMO-2048", "Distribution center", "Custom product collection", "Your order is on its way", '"total_minor"', '"paid_minor"']) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(hidden.customerName, "Alex Morgan");
});

test("invoice visibility and overview visibility can be controlled independently", () => {
  const design = defaultPortalDesign();
  design.sections.find(s => s.type === "invoice")!.enabled = false;
  const data = portalPreviewData(design);
  assert.equal(data.invoice, null); assert.equal(data.overview?.total_minor, 240000);
  design.sections.find(s => s.type === "invoice")!.enabled = true;
  design.sections.find(s => s.type === "overview")!.enabled = false;
  assert.ok(portalPreviewData(design).invoice); assert.equal(portalPreviewData(design).overview, null);
});

test("feature permissions require both the action and its parent section", () => {
  const design = defaultPortalDesign();
  assert.equal(portalFeatureAllowed(design, "downloadInvoice"), true);
  assert.equal(portalFeatureAllowed(design, "sendMessages"), true);
  design.features.sendMessages = false;
  assert.equal(portalFeatureAllowed(design, "sendMessages"), false);
  assert.equal(portalPreviewData(design).messages.length, 1);
  design.sections.find(s => s.type === "invoice")!.enabled = false;
  assert.equal(portalFeatureAllowed(design, "downloadInvoice"), false);
  design.features.sendMessages = true;
  design.sections.find(s => s.type === "messages")!.enabled = false;
  assert.equal(portalFeatureAllowed(design, "sendMessages"), false);
});

test("only admins can manage a portal and accent foregrounds retain contrast", () => {
  assert.equal(canManagePortal("admin"), true);
  for (const role of ["operator", "bd_manager", "viewer", "customer", ""]) assert.equal(canManagePortal(role), false);
  assert.equal(portalAccentForeground("#ffffff"), "#111827");
  assert.equal(portalAccentForeground("#000000"), "#ffffff");
});

const require = createRequire(import.meta.url);
class PortalError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
test("disabled customer API actions reject direct requests without writing messages or rendering PDFs", async () => {
  for (const feature of ["downloadInvoice", "sendMessages"] as const) {
    let mutations = 0;
    const design = defaultPortalDesign(); design.features[feature] = false;
    const deps: Record<string, unknown> = {
      "@/lib/data/customer-workspace": { withCustomerWorkspace: (_request: Request, work: () => unknown) => work() },
      "@/lib/data/customer-portal": { portalHeaders: {}, checkPortalOrigin() {}, PortalError, portalSession: async () => ({ invoice: {} }), portalLimit: async () => {}, portalError: (err: PortalError) => Response.json({ error: err.message }, { status: err.status }) },
      "@/lib/data/portal-design": { getPublishedPortalDesign: async () => design },
      "@/lib/portal-design": { portalFeatureAllowed },
      "@/lib/supabase/admin": { createSupabaseAdmin: () => { mutations++; throw new Error("Unexpected DB write"); } },
      "@/lib/invoice-pdf": { renderInvoicePdf: async () => { mutations++; return new Uint8Array(); } },
      "@/lib/invoice-pdf-meta": { invoicePdfFilename: () => "invoice.pdf" },
    };
    const route = feature === "sendMessages" ? "messages" : "pdf";
    const source = readFileSync(`app/api/customer/invoices/[id]/${route}/route.ts`, "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, (request: Request, context: unknown) => Promise<Response>> = {};
    vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? require(name), Response, Request, console });
    const method = feature === "sendMessages" ? "POST" : "GET";
    const response = await exports[method](new Request("https://crm.test/api/customer/invoices/test", { method }), { params: Promise.resolve({ id: "717cd1d4-0739-4f3f-bbba-a331c7422f31" }) });
    assert.equal(response.status, 403); assert.equal(mutations, 0);
  }
});
