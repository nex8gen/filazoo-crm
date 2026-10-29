import * as replyTools from "../lib/ai/crm-reply-tools.ts";
import * as readiness from "../lib/ai/invoice-readiness.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as tools from "../lib/ai/crm-tools.ts";
import * as flows from "../lib/flows.ts";
import * as orders from "../lib/purchase-orders.ts";
import * as products from "../lib/product-utils.ts";
import * as preferences from "../lib/user-preferences.ts";
import * as defaults from "../lib/invoice-defaults.ts";
import * as permissions from "../lib/invoice-permissions.ts";
import * as invoices from "../lib/invoices.ts";
import * as paymentMethods from "../lib/invoice-payment-methods.ts";
import * as assistant from "../lib/ai/workspace-assistant.ts";
import * as agentActions from "../lib/ai/agent-actions.ts";
import * as progress from "../lib/ai/agent-progress.ts";
import * as profileFields from "../lib/company-profile-fields.ts";
import * as segments from "../lib/segments.ts";
import * as productivity from "../lib/ai/crm-productivity.ts";
import { personalProductService } from "./helpers/personal-products.ts";

const require = createRequire(import.meta.url);
const companyId = "a1111111-1111-4111-8111-111111111111";
const recordId = "b2222222-2222-4222-8222-222222222222";
const actorId = "c3333333-3333-4333-8333-333333333333";
const actionId = "d4444444-4444-4444-8444-444444444444";
const viewer = { id: actorId, role: "admin" as const, displayName: "Sales Manager", email: "sales@example.com", preferences: { ...preferences.defaultUserPreferences, emailSignature: "Keep my signature", tablePageSize: 50 as const } };
const request = new Request("http://localhost:3000/api/ai/assistant/action");

function moduleUnderTest<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? (name === "./crm-reply-tools" ? replyTools : name === "./crm-reply-execution" ? { replyOperationTarget: () => { throw new Error("Reply workflows use their dedicated fixtures"); } } : name === "../data/customer-reply-requests" ? { listReplyRequests: async () => [] } : name === "@/lib/ai/invoice-readiness" ? readiness : undefined) ?? require(name), Request, Response, FormData, URL, Date, Intl, Error, crypto, console });
  return exports as T;
}
function fixture() {
  const variants = [{ id: "black", name: "Black", sku: "PLA-BLACK", price: "9.50", stockStatus: "In stock", imageUrl: null }];
  const product = { sku: "PLA", name: "PLA filament", material: "PLA", color: "Black", diameter: "1.75mm", weight: "1kg", price: 9.5, currency: "USD", moq: 10, tags: ["price-tier:10:9.5", products.variantTag(variants)], stock_status: "In stock", lead_time: "7 days", image_url: null, active: true, sheet_updated_at: "2026-10-27T00:00:00Z" };
  const document = orders.purchaseOrderSchema.parse({ reference: "PO-42", orderDate: "2026-10-27", deliveryDate: "", currency: "USD", status: "confirmed", shippingAddress: "Saved warehouse", shippingRecipient: "Buyer", shippingPhone: "123", notes: "Keep terms", items: [{ description: "Agreed custom part", sku: "CUSTOM", quantity: 10, unitPriceMinor: 1234 }] });
  const tables: Record<string, Record<string, unknown>[]> = {
    products: [product], purchase_orders: [{ id: recordId, company_id: companyId, version: 3, document }],
    flows: [{ id: recordId, user_id: actorId }], workspace_members: [{ user_id: actorId, display_name: "Sales Manager", role: "admin", activated_at: "2026-10-27T00:00:00Z" }],
    workspace_mailboxes: [{ id: recordId, user_id: actorId, type: "personal", email: "sales@example.com", is_active: true }],
    invoice_settings: [{ singleton: true, settings: { sellerName: "Filazoo", sellerAddress: "Saved address", sellerTaxId: "VAT-OLD", paymentInstructions: "Saved instructions", notes: "Keep notes", defaults: { currency: "USD", termsDays: 30, taxBps: 750 }, paymentMethods: [] } }],
    meta_messages: [{ id: recordId, direction: "inbound", sender_id: "customer-42", recipient_id: "our-page", source: "instagram_messaging", customer_name: "Buyer" }],
    crm_tasks: [{ id: recordId, title: "Call buyer", status: "open", assigned_to: actorId }],
    company_segments: [{ id: recordId, name: "US prospects", description: "Keep description", rules: { country: "United States", hasEmail: true } }],
    internal_notifications: [{ id: recordId, message: "Buyer replied", user_id: actorId, read_at: null }],
  };
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const inventory = { status: { configured: true, configurationError: null as string | null, warehouseIds: "warehouse-1", stale: false }, snapshots: [{ sku: "ERP-BLACK", available: 23, on_hand: 25, locked: 2, warehouse_ids: ["warehouse-1"], synced_at: "2026-10-29T00:00:00Z" }], skuMap: { "PLA-BLACK": "ERP-BLACK" } };
  let failure = false;
  let companyName = "Example Print Studio";
  const flow = { id: recordId, ...flows.defaultFlowInput, status: "paused", updatedAt: "2026-10-27T00:00:00Z" };
  const invoice = { id: recordId, number: 42, status: "draft", revision: 3, created_by: actorId, document: { ...invoices.blankInvoiceDocument("2026-10-27"), companyId, customerName: "Buyer" }, total_minor: 12340, paid_minor: 0 };
  const db = { from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let selected: string | undefined;
    let insertion: Record<string, unknown>[] | undefined;
    const run = () => {
      if (insertion) (tables[table] ??= []).push(...insertion);
      const rows = (tables[table] ?? []).filter((row) => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      calls.push({ name: "read", args: [table, selected, filters] });
      return { data: rows, count: rows.length, error: null };
    };
    const query = { select(fields?: string) { selected = fields; return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, in(key: string, values: unknown[]) { filters.push([key, values]); return query; }, order() { return query; }, limit() { return query; }, insert(rows: Record<string, unknown>[]) { insertion = rows; return query; }, async maybeSingle() { const result = run(); return { ...result, data: result.data[0] ?? null }; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve(run()).then(resolve); } };
    return query;
  } };
  const shared = (name: string) => async (...args: unknown[]) => { calls.push({ name, args }); return failure ? { error: "Shared CRM validation failed" } : { success: "Saved by shared service" }; };
  const dependencies = {
    "../data/product-personalization": personalProductService(tables),
    "./crm-productivity": productivity, "./crm-productivity-execution": {}, "./crm-productivity-records": {},
    "next/cache": { revalidatePath() {} }, "./crm-tools": tools, "../supabase/admin": { createSupabaseAdmin: () => db },
    "@/app/crm-actions": Object.fromEntries(["scheduleCompanyFollowup", "assignPipelineOwner", "bulkUpdateCompanies", "createCatalog", "createProduct", "updateProduct"].map((name) => [name, shared(name)])),
    "@/app/settings/actions": Object.fromEntries(["updateProfile", "inviteMember", "updateMember", "deleteMember", "manageMailbox"].map((name) => [name, shared(name)])),
    "@/app/settings/preference-actions": { saveUserPreferences: shared("saveUserPreferences") },
    "@/app/segment-actions": { createSegment: shared("createSegment"), updateSegment: shared("updateSegment") },
    "@/app/inventory-actions": { syncInventory: async () => { calls.push({ name: "syncInventory", args: [] }); return failure ? { ok: false, error: "ERP unavailable" } : { ok: true, skipped: false, count: 1 }; } },
    "../data/inventory": { getInventoryState: async () => inventory }, "../segments": segments,
    "@/app/purchase-order-actions": { savePurchaseOrder: shared("savePurchaseOrder"), createOrderInvoice: async (...args: unknown[]) => { calls.push({ name: "createOrderInvoice", args }); return { invoiceId: recordId }; }, getPurchaseOrderProfile: async () => ({ customer: { companyName: "Buyer", contactName: "", contactRole: "", contactEmail: "", billingEmail: "", billingAddress: "", taxId: "", phone: "" }, commerce: { currency: "USD", shippingAddress: "Default warehouse" } }) },
    "@/app/api/email/state/route": { POST: async (input: Request) => { calls.push({ name: "saveEmailState", args: [await input.json()] }); return Response.json({ ok: true }); } },
    "../meta-messenger": { sendMetaTextMessage: async (...args: unknown[]) => { calls.push({ name: "sendMetaTextMessage", args }); return { ok: true }; } },
    "../data/flows": { listWorkspaceFlows: async () => [flow], createFlow: async (_user: string, input: object) => { calls.push({ name: "createFlow", args: [input] }); return { id: recordId, ...input }; }, updateFlow: async (_user: string, _id: string, input: object) => { calls.push({ name: "updateFlow", args: [input] }); return { id: recordId, ...input }; }, deleteFlow: shared("deleteFlow") },
    "../data/invoices": { getInvoice: async () => invoice, mutateInvoice: async (...args: unknown[]) => { calls.push({ name: "mutateInvoice", args }); return invoice; }, createInvoice: async (...args: unknown[]) => { calls.push({ name: "createInvoice", args }); return invoice; } },
    "../data/invoice-connections": { invoiceBootstrap: async () => ({ document: invoice.document }), validateInvoiceConnections: async () => {} },
    "../data/invoice-payment-methods": { patchInvoiceSettings: shared("patchInvoiceSettings"), invoicePaymentMethods: async () => [] },
    "../data/members": { listWorkspaceMembers: async () => [{ id: actorId, displayName: "Sales Manager", email: "sales@example.com", role: "admin", autoAssignLeads: false, activated: true }] },
    "../data/flow-activity": { updateFlowActivity: shared("updateFlowActivity") },
    "../invoice-defaults": defaults, "../user-preferences": preferences, "../flows": flows, "../purchase-orders": orders, "../product-utils": products, "../invoice-permissions": permissions, "../invoices": invoices, "../invoice-payment-methods": paymentMethods,
    "./agent-records": { loadAgentCompany: async () => ({ id: companyId, fields: { name: companyName } }), loadAgentEmails: async () => ({ current: { id: "mail-1", subject: "Hello", contact: "buyer@example.com", read: true, starred: true, category: "Interested", threadId: "thread-1" } }) },
  };
  const execution = moduleUnderTest<typeof import("../lib/ai/crm-execution.ts")>("../lib/ai/crm-execution.ts", dependencies);
  return { ...execution, tables, calls, flow, invoice, inventory, dependencies, changeCompany() { companyName = "Changed"; }, fail() { failure = true; } };
}

test("saved audience segment actions execute through the CRM service, preserve omitted fields and reject stale rules", async () => {
  const f = fixture();
  const created = await f.prepareCrmAction({ op: "create_segment", segment: { name: "Audit prospects", description: "Synthetic", rules: { country: "United States", minFitScore: 7, hasEmail: true } } }, viewer);
  await f.executeCrmAction(created, viewer, actionId, request);
  const form = f.calls.find((call) => call.name === "createSegment")!.args[1] as FormData;
  assert.equal(form.get("name"), "Audit prospects");
  assert.equal(JSON.parse(String(form.get("rules"))).minFitScore, 7);
  const changed = await f.prepareCrmAction({ op: "update_segment", segmentId: recordId, changes: { name: "Renamed audience" } }, viewer);
  await f.executeCrmAction(changed, viewer, actionId, request);
  const saved = f.calls.find((call) => call.name === "updateSegment")!.args[1] as FormData;
  assert.equal(saved.get("description"), "Keep description");
  assert.deepEqual(JSON.parse(String(saved.get("rules"))), { country: "United States", hasEmail: true });
  f.tables.company_segments[0].rules = { country: "Canada" };
  await assert.rejects(() => f.executeCrmAction(changed, viewer, actionId, request), /changed after/);
  f.fail();
  await assert.rejects(() => f.executeCrmAction(created, viewer, actionId, request), /Shared CRM validation failed/);
  await assert.rejects(() => f.prepareCrmAction({ op: "update_segment", segmentId: actionId, changes: { name: "Missing" } }, viewer), /no longer available/);
  await assert.rejects(() => f.prepareCrmAction(created.operation, { ...viewer, role: "viewer" }), /read-only/);
  assert.equal(tools.crmOperationSchema.safeParse({ op: "create_segment", segment: { name: "Invalid", description: "", rules: { companyIds: [companyId], country: "US" } } }).success, false);
});

test("ERP inventory sync executes only with the proper role and configured scope and propagates failure", async () => {
  const f = fixture();
  const proposal = await f.prepareCrmAction({ op: "sync_inventory" }, viewer);
  assert.equal(tools.crmManualApproval(proposal.operation), true);
  assert.equal(f.calls.some((call) => call.name === "syncInventory"), false);
  const saved = await f.executeCrmAction(proposal, viewer, actionId, request);
  assert.match(saved.success!, /1 stock records/);
  await assert.rejects(() => f.prepareCrmAction({ op: "sync_inventory" }, { ...viewer, role: "bd_manager" }), /admin or operator/);
  f.fail();
  await assert.rejects(() => f.executeCrmAction(proposal, viewer, actionId, request), /ERP unavailable/);
  f.inventory.status.warehouseIds = "changed-warehouse";
  await assert.rejects(() => f.executeCrmAction(proposal, viewer, actionId, request), /changed after/);
  f.inventory.status.configured = false;
  await assert.rejects(() => f.prepareCrmAction({ op: "sync_inventory" }, viewer), /active ERP connection/);
});

test("inventory lookup resolves CRM SKU aliases and exposes saved stock coverage without starting a sync", async () => {
  const f = fixture();
  const records = moduleUnderTest<typeof import("../lib/ai/crm-records.ts")>("../lib/ai/crm-records.ts", f.dependencies);
  const result = await records.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "inventory", id: "PLA-BLACK" }));
  assert.equal(result.records.length, 1);
  assert.equal((result.records[0] as { available: number }).available, 23);
  assert.equal(result.coverage.nextOffset, null);
  assert.equal(f.calls.some((call) => call.name === "syncInventory"), false);
  const missing = await records.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "inventory", query: "unknown-sku" }));
  assert.equal(missing.records.length, 0);
  await assert.rejects(() => records.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "inventory", companyId })), /company filter/);
});

test("customer, catalog, product and account operations dispatch real validated arguments to shared CRM services", async () => {
  const cases: Array<{ operation: tools.CrmOperation; service: string }> = [
    { operation: { op: "schedule_followup", companyId, dueAt: "2099-10-30T09:00:00+08:00" }, service: "scheduleCompanyFollowup" },
    { operation: { op: "assign_owner", companyId, ownerId: actorId }, service: "assignPipelineOwner" },
    { operation: { op: "delete_company", companyId }, service: "bulkUpdateCompanies" },
    { operation: { op: "create_catalog", companyId, currency: "USD", productSkus: ["PLA"] }, service: "createCatalog" },
    { operation: { op: "update_profile", displayName: "Audit Sales" }, service: "updateProfile" },
    { operation: { op: "invite_member", email: "audit@example.com", displayName: "Audit User", role: "viewer" }, service: "inviteMember" },
    { operation: { op: "update_member", userId: actorId, displayName: "Sales Manager", email: "sales@example.com", role: "admin", autoAssignLeads: false }, service: "updateMember" },
    { operation: { op: "delete_member", userId: actorId }, service: "deleteMember" },
    ...(["stop", "resume", "delete"] as const).map((operation) => ({ operation: { op: "manage_mailbox" as const, mailboxId: recordId, operation }, service: "manageMailbox" })),
  ];
  for (const item of cases) {
    const f = fixture();
    const proposal = await f.prepareCrmAction(item.operation, viewer);
    if (item.operation.op === "create_catalog") {
      assert.ok(!JSON.stringify(proposal.preview).includes("variant-json"));
      assert.ok(!JSON.stringify(proposal.preview).includes("price-tier:"));
      assert.equal((proposal.preview.products as { tiers: { unitPriceMinor: number }[] }[])[0].tiers[0].unitPriceMinor, 950);
    }
    assert.equal(f.calls.some((call) => call.name === item.service), false);
    const result = await f.executeCrmAction(proposal, viewer, actionId, request);
    assert.ok(result.success, item.operation.op);
    assert.equal(f.calls.filter((call) => call.name === item.service).length, 1, item.operation.op);
  }
  const f = fixture();
  const product = tools.agentProductSchema.parse(f.productFromRow(f.tables.products[0]));
  const proposal = await f.prepareCrmAction({ op: "create_product", product: { ...product, sku: "AUDIT-NEW", active: false } }, viewer);
  await f.executeCrmAction(proposal, viewer, actionId, request);
  const form = f.calls.find((call) => call.name === "createProduct")!.args[1] as FormData;
  assert.equal(form.get("sku"), "AUDIT-NEW"); assert.equal(form.get("price1"), "9.5");
  assert.equal(JSON.parse(String(form.get("variants")))[0].sku, "PLA-BLACK");
});

test("invoice issue, void, draft deletion and flow duplication execute their shared lifecycle services", async () => {
  for (const action of ["issue", "void", "delete"] as const) {
    const f = fixture();
    const proposal = await f.prepareCrmAction({ op: "invoice_lifecycle", invoiceId: recordId, action }, viewer);
    await f.executeCrmAction(proposal, viewer, actionId, request);
    const mutation = f.calls.find((call) => call.name === "mutateInvoice")!.args[2] as { action: string; revision: number };
    assert.equal(mutation.action, action); assert.equal(mutation.revision, 3);
  }
  const f = fixture();
  const proposal = await f.prepareCrmAction({ op: "duplicate_flow", flowId: recordId, name: "Audit duplicate" }, viewer);
  await f.executeCrmAction(proposal, viewer, actionId, request);
  const saved = f.calls.find((call) => call.name === "createFlow")!.args[0] as flows.FlowInput;
  assert.equal(saved.name, "Audit duplicate"); assert.equal(saved.status, "draft");
  assert.equal(saved.steps.length, f.flow.steps.length);
  const edit = await f.prepareCrmAction({ op: "update_flow", flowId: recordId, changes: { name: "Audit edited" } }, viewer);
  await f.executeCrmAction(edit, viewer, actionId, request);
  assert.equal((f.calls.find((call) => call.name === "updateFlow")!.args[0] as flows.FlowInput).name, "Audit edited");
  const deletion = await f.prepareCrmAction({ op: "delete_flow", flowId: recordId }, viewer);
  await f.executeCrmAction(deletion, viewer, actionId, request);
  assert.equal(f.calls.filter((call) => call.name === "deleteFlow").length, 1);
});

test("partial schemas do not populate defaults or accept arbitrary operations", () => {
  const pref = tools.crmOperationSchema.parse({ op: "save_preferences", changes: { density: "compact" } });
  assert.deepEqual(pref, { op: "save_preferences", changes: { density: "compact" } });
  const order = tools.crmOperationSchema.parse({ op: "save_order", companyId, orderId: recordId, changes: { status: "shipped" } });
  assert.deepEqual(order.changes, { status: "shipped" });
  for (const input of [{ op: "execute_sql", sql: "delete from companies" }, { op: "save_preferences", changes: {} }, { op: "assign_owner", companyId, ownerId: actorId, role: "admin" }, { op: "invoice_lifecycle", invoiceId: recordId, action: "payment" }, { op: "invoice_lifecycle", invoiceId: recordId, action: "issue", payment: { amountMinor: 1 } }]) assert.equal(tools.crmOperationSchema.safeParse(input).success, false);
});

test("product updates retain variants and prices; stale proposals and service errors cannot report success", async () => {
  const f = fixture();
  const proposal = await f.prepareCrmAction({ op: "update_product", sku: "PLA", changes: { name: "New name" } }, viewer);
  assert.equal(agentActions.preparedAgentActionSchema.safeParse(proposal).success, true);
  await f.executeCrmAction(proposal, viewer, actionId, request);
  const form = f.calls.find((call) => call.name === "updateProduct")!.args[1] as FormData;
  assert.equal(form.get("price1"), "9.5");
  assert.equal(form.get("originalSku"), "PLA");
  assert.equal(form.get("diameter"), "1.75mm");
  assert.equal(JSON.parse(String(form.get("variants")))[0].sku, "PLA-BLACK");
  f.tables.products[0].price = 20;
  await assert.rejects(() => f.executeCrmAction(proposal, viewer, actionId, request), /changed after the proposal/);
  const fresh = await f.prepareCrmAction({ op: "update_product", sku: "PLA", changes: { active: false } }, viewer);
  f.fail();
  await assert.rejects(() => f.executeCrmAction(fresh, viewer, actionId, request), /Shared CRM validation failed/);
});

test("purchase-order edits preserve agreed items, shipping, terms and optimistic version", async () => {
  const f = fixture();
  const action = await f.prepareCrmAction({ op: "save_order", companyId, orderId: recordId, changes: { status: "in_production" } }, viewer);
  await f.executeCrmAction(action, viewer, actionId, request);
  const args = f.calls.find((call) => call.name === "savePurchaseOrder")!.args;
  assert.equal(args[2], 3);
  const saved = args[3] as orders.PurchaseOrderDocument;
  assert.equal(saved.items[0].unitPriceMinor, 1234);
  assert.equal(saved.shippingAddress, "Saved warehouse");
  assert.equal(saved.notes, "Keep terms");
  f.tables.purchase_orders[0].company_id = actorId;
  await assert.rejects(() => f.prepareCrmAction({ op: "invoice_order", companyId, orderId: recordId }, viewer), /does not belong/);
});

test("new purchase orders use profile defaults and require an actual PO reference and items", async () => {
  const f = fixture();
  const action = await f.prepareCrmAction({ op: "save_order", companyId, changes: { reference: "PO-NEW", items: [{ description: "Explicit negotiated part", sku: "CUSTOM", quantity: 4, unitPriceMinor: 1000 }] } }, viewer);
  const document = action.preview.document as orders.PurchaseOrderDocument;
  assert.equal(document.status, "draft");
  assert.equal(document.shippingAddress, "Default warehouse");
  assert.equal(document.preShipmentPercent, 100);
  await assert.rejects(() => f.prepareCrmAction({ op: "save_order", companyId, changes: { notes: "Insufficient information" } }, viewer));
});

test("flows preserve existing definitions and enforce ownership; duplicates are always drafts", async () => {
  const f = fixture();
  const proposal = await f.prepareCrmAction({ op: "flow_status", flowId: recordId, status: "live" }, viewer);
  await f.executeCrmAction(proposal, viewer, actionId, request);
  const saved = f.calls.find((call) => call.name === "updateFlow")!.args[0] as flows.FlowInput;
  assert.equal(saved.status, "live");
  assert.equal(saved.steps.length, flows.defaultFlowInput.steps.length);
  const timing = await f.prepareCrmAction({ op: "update_flow", flowId: recordId, changes: { triggerConfig: { amount: 7 } } }, viewer);
  const config = (timing.preview.flow as flows.FlowInput).triggerConfig;
  assert.equal(config.amount, 7); assert.equal(config.unit, "days"); assert.equal(config.businessDays, true);
  const copy = await f.prepareCrmAction({ op: "duplicate_flow", flowId: recordId, name: "Copy" }, viewer);
  assert.equal((copy.preview.flow as flows.FlowInput).status, "draft");
  await assert.rejects(() => f.prepareCrmAction({ op: "delete_flow", flowId: recordId }, { ...viewer, id: actionId, role: "operator" }), /cannot manage/);
});

test("invoice lifecycle rechecks permissions and versions; payment IDs come from the claimed action", async () => {
  const f = fixture();
  f.invoice.status = "issued";
  const payment = { amountMinor: 5000, paidOn: "2026-10-27", method: "bank_transfer" as const, reference: "BANK-42" };
  const action = await f.prepareCrmAction({ op: "invoice_lifecycle", invoiceId: recordId, action: "payment", payment }, viewer);
  await f.executeCrmAction(action, viewer, actionId, request);
  const mutation = f.calls.find((call) => call.name === "mutateInvoice")!.args[2] as { payment: { id: string; amountMinor: number } };
  assert.equal(mutation.payment.id, actionId);
  assert.equal(mutation.payment.amountMinor, 5000);
  f.invoice.revision++;
  await assert.rejects(() => f.executeCrmAction(action, viewer, actionId, request), /changed after the proposal/);
  await assert.rejects(() => f.prepareCrmAction({ op: "invoice_lifecycle", invoiceId: recordId, action: "delete" }, viewer), /Only a draft/);
  await assert.rejects(() => f.prepareCrmAction({ op: "invoice_lifecycle", invoiceId: recordId, action: "payment", payment }, { ...viewer, role: "bd_manager" }), /admin or operator/);
});

test("email organization preserves other flags and messaging resolves its recipient and channel from the database", async () => {
  const f = fixture();
  const email = await f.prepareCrmAction({ op: "set_email_state", emailId: "mail-1", changes: { folder: "archive" } }, viewer);
  await f.executeCrmAction(email, viewer, actionId, request);
  const saved = f.calls.find((call) => call.name === "saveEmailState")!.args[0] as Record<string, unknown>;
  assert.equal(saved.starred, true); assert.equal(saved.read, true); assert.equal(saved.category, "Interested"); assert.equal(saved.folder, "archive");
  const message = await f.prepareCrmAction({ op: "send_message", messageId: recordId, text: "Your quote is ready" }, viewer);
  await f.executeCrmAction(message, viewer, actionId, request);
  const send = f.calls.find((call) => call.name === "sendMetaTextMessage")!.args[0] as Record<string, unknown>;
  assert.equal(send.to, "customer-42"); assert.equal(send.channel, "instagram");
  f.tables.meta_messages[0].direction = "outbound";
  await assert.rejects(() => f.prepareCrmAction({ op: "send_message", messageId: recordId, text: "Hi" }, viewer), /actual inbound/);
});

test("message drafts resolve the open conversation, recheck access and never send", async () => {
  const f = fixture();
  Object.assign(f.tables.meta_messages[0], { page_id: "our-page", thread_id: "customer-42" });
  const proposal = await f.prepareCrmAction({ op: "draft_message", messageId: recordId, text: "Which PLA colors do you need?" }, viewer);
  assert.equal(agentActions.preparedAgentActionSchema.safeParse(proposal).success, true);
  const result = await f.executeCrmAction(proposal, viewer, actionId, request);
  assert.deepEqual(JSON.parse(JSON.stringify(result.draftMessage)), { conversationId: "instagram:our-page:customer-42", text: "Which PLA colors do you need?" });
  assert.equal(f.calls.some((call) => call.name === "sendMetaTextMessage"), false);
  f.tables.meta_messages[0].direction = "outbound";
  await assert.rejects(() => f.executeCrmAction(proposal, viewer, actionId, request), /actual inbound/);
  await assert.rejects(() => f.prepareCrmAction({ op: "draft_message", messageId: recordId, text: "Hi" }, { ...viewer, role: "viewer" }), /read-only/);
});

test("preferences and invoice defaults merge only explicit changes", async () => {
  const f = fixture();
  const pref = await f.prepareCrmAction(tools.crmOperationSchema.parse({ op: "save_preferences", changes: { density: "compact" } }), viewer);
  await f.executeCrmAction(pref, viewer, actionId, request);
  const saved = f.calls.find((call) => call.name === "saveUserPreferences")!.args[0] as preferences.UserPreferences;
  assert.equal(saved.emailSignature, "Keep my signature"); assert.equal(saved.tablePageSize, 50);
  const billing = await f.prepareCrmAction(tools.crmOperationSchema.parse({ op: "invoice_defaults", defaults: { termsDays: 45 } }), viewer);
  await f.executeCrmAction(billing, viewer, actionId, request);
  const patch = f.calls.find((call) => call.name === "patchInvoiceSettings")!.args[0] as { sellerTaxId: string; defaults: { taxBps: number; termsDays: number } };
  assert.equal(patch.sellerTaxId, "VAT-OLD"); assert.equal(patch.defaults.taxBps, 750); assert.equal(patch.defaults.termsDays, 45);
});

test("all new operations reject viewers before reading records and admin tools reject operators", async () => {
  const f = fixture();
  for (const operation of [{ op: "schedule_followup", companyId, dueAt: "" }, { op: "delete_company", companyId }, { op: "assign_owner", companyId, ownerId: actorId }, { op: "invite_member", email: "test@example.com", displayName: "Test", role: "operator" }, { op: "delete_member", userId: actorId }]) {
    const parsed = tools.crmOperationSchema.parse(operation);
    await assert.rejects(() => f.prepareCrmAction(parsed, { ...viewer, role: "viewer" }), /read-only/);
    if (operation.op !== "schedule_followup") await assert.rejects(() => f.prepareCrmAction(parsed, { ...viewer, role: "operator" }), /administrator/);
  }
  assert.equal(f.calls.length, 0);
  await assert.rejects(() => f.prepareCrmAction({ op: "manage_mailbox", mailboxId: recordId, operation: "stop" }, { ...viewer, id: actionId, role: "operator" }), /cannot manage/);
});

test("new actions enter stored approval and financial/destructive actions stay manual in auto mode", async () => {
  const f = fixture();
  const execution = moduleUnderTest<typeof import("../lib/ai/agent-execution.ts")>("../lib/ai/agent-execution.ts", {
    ...f.dependencies, "@/app/api/email/send/route": {}, "../data/invoice-connections": {}, "../data/invoice-banks": {}, "../data/mailboxes": {}, "../company-profile-fields": profileFields,
    "../invoices": invoices, "./agent-actions": agentActions, "./agent-progress": progress, "./crm-execution": f, "../email-threading": {},
    "./agent-catalog": {},
  });
  const proposals = await execution.prepareAgentActions([
    { type: "crm_action", operation: { op: "delete_company", companyId } },
    { type: "crm_action", operation: { op: "schedule_followup", companyId, dueAt: "2026-10-29T09:00:00+08:00" } },
  ], viewer, "auto");
  assert.equal(proposals[0].approvalMode, "ask"); assert.equal(proposals[1].approvalMode, "auto");
  assert.equal(f.tables.workspace_agent_actions.length, 2);
  assert.equal(f.calls.filter((call) => !["read"].includes(call.name)).length, 0);
});

test("lookup protocol validates resources, rejects combined read/mutate output, and preserves original instructions", () => {
  assert.equal(tools.extractCrmRead('FILAZOO_CRM_READ_JSON: {"resource":"products","query":"PLA"}')?.resource, "products");
  assert.throws(() => tools.extractCrmRead('FILAZOO_CRM_READ_JSON: {"resource":"auth.users"}'));
  assert.throws(() => tools.extractCrmRead('FILAZOO_ACTIONS_JSON: []\nFILAZOO_CRM_READ_JSON: {"resource":"products"}'));
  const output = assistant.extractWorkspaceActions(`Ready for review.\nFILAZOO_ACTIONS_JSON: [{"type":"crm_action","operation":{"op":"schedule_followup","companyId":"${companyId}","dueAt":""}}]`);
  assert.equal(output.actions[0].type, "crm_action");
  const instruction = assistant.workspaceAssistantInstruction("work", "2026-10-27T04:00:00Z");
  assert.match(instruction, /create_invoice/); assert.match(instruction, /write_email/); assert.match(instruction, /shippingMinor:3900/); assert.match(instruction, /FILAZOO_CRM_READ_JSON/);
  assert.ok(!assistant.workspaceAssistantInstruction("analyze", "now").includes("FILAZOO_CRM_READ_JSON"));
});

test("custom-price invoices use explicit cents, remain drafts, and cannot detach order links", async () => {
  const f = fixture();
  const items = [{ description: "Agreed custom part", quantity: 4, unitPriceMinor: 1250, taxBps: 0 }];
  const create = await f.prepareCrmAction({ op: "custom_invoice", companyId, items }, viewer);
  await f.executeCrmAction(create, viewer, actionId, request);
  const args = f.calls.find((call) => call.name === "createInvoice")!.args;
  assert.equal(args[2], actionId);
  const doc = args[0] as invoices.InvoiceDocument;
  assert.equal(invoices.invoiceTotals(doc).total, 5000);
  assert.equal(doc.items[0].pricingMode, "manual");
  const edit = await f.prepareCrmAction({ op: "custom_invoice", companyId, invoiceId: recordId, items }, viewer);
  await f.executeCrmAction(edit, viewer, actionId, request);
  const mutation = f.calls.find((call) => call.name === "mutateInvoice")!.args[2] as { revision: number; action: string };
  assert.equal(mutation.revision, 3); assert.equal(mutation.action, "save");
  f.invoice.document.purchaseOrderId = recordId;
  await assert.rejects(() => f.prepareCrmAction({ op: "custom_invoice", companyId, invoiceId: recordId, items }, viewer), /linked purchase-order/);
});

test("activity updates are scoped to the signed-in user and shared service", async () => {
  const f = fixture();
  for (const kind of ["task", "alert"] as const) {
    const proposal = await f.prepareCrmAction({ op: "complete_activity", kind, id: recordId }, viewer);
    await f.executeCrmAction(proposal, viewer, actionId, request);
    await assert.rejects(() => f.prepareCrmAction({ op: "complete_activity", kind, id: recordId }, { ...viewer, id: actionId }), /another teammate/);
  }
  assert.equal(f.calls.filter((call) => call.name === "updateFlowActivity").length, 2);
});

test("record lookups bound results, scope private resources and never select credentials", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const query = {
    select(...args: unknown[]) { calls.push(["select", ...args]); return query; },
    eq(...args: unknown[]) { calls.push(["eq", ...args]); return query; },
    ilike(...args: unknown[]) { calls.push(["ilike", ...args]); return query; },
    or(...args: unknown[]) { calls.push(["or", ...args]); return query; },
    order(...args: unknown[]) { calls.push(["order", ...args]); return query; },
    range(...args: unknown[]) { calls.push(["range", ...args]); return query; },
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [{ id: recordId }], count: 11, error: null }).then(resolve); },
  };
  const f = fixture();
  const records = moduleUnderTest<typeof import("../lib/ai/crm-records.ts")>("../lib/ai/crm-records.ts", {
    ...f.dependencies,
    "../supabase/admin": { createSupabaseAdmin: () => ({ from(table: string) { calls.push(["from", table]); return query; } }) },
  });
  const result = await records.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "mailboxes" }));
  assert.equal(result.coverage.nextOffset, 1);
  assert.ok(!String(calls.find(([method]) => method === "select")?.[1]).includes("password"));
  assert.ok(!String(calls.find(([method]) => method === "select")?.[1]).includes("*"));
  calls.length = 0;
  await records.readCrmRecords({ ...viewer, role: "operator" }, tools.crmReadSchema.parse({ resource: "mailboxes" }));
  assert.ok(calls.some(([method, key, value]) => method === "eq" && key === "user_id" && value === actorId));
  assert.ok(calls.some(([method, key, value]) => method === "eq" && key === "type" && value === "personal"));
  calls.length = 0;
  await records.readCrmRecords(viewer, tools.crmReadSchema.parse({ resource: "tasks", offset: 10 }));
  assert.ok(calls.some(([method, key, value]) => method === "eq" && key === "assigned_to" && value === actorId));
  assert.ok(calls.some(([method, from, to]) => method === "range" && from === 10 && to === 19));
  const personal = await records.readCrmRecords({ ...viewer, role: "bd_manager" }, tools.crmReadSchema.parse({ resource: "settings" }));
  assert.equal("billing" in personal.records[0], false);
  assert.equal((personal.records[0] as { preferences: preferences.UserPreferences }).preferences.tablePageSize, 50);
});

test("new payment methods receive server IDs and full validation before review", async () => {
  const f = fixture();
  const action = await f.prepareCrmAction({ op: "payment_methods", paymentMethods: [{ type: "paypal", label: "PayPal", currency: "USD", details: "billing@example.com", paymentUrl: "" }] }, viewer);
  assert.match((action.preview.changes as { paymentMethods: { id: string }[] }).paymentMethods[0].id, /^[0-9a-f-]{36}$/);
  await f.executeCrmAction(action, viewer, actionId, request);
  const saved = f.calls.find((call) => call.name === "patchInvoiceSettings")!.args[0] as { paymentMethods: { id: string }[] };
  assert.equal(saved.paymentMethods[0].id, (action.preview.changes as typeof saved).paymentMethods[0].id);
  await assert.rejects(() => f.prepareCrmAction({ op: "payment_methods", paymentMethods: [{ type: "bank_transfer", label: "Incomplete bank", currency: "USD", details: "", paymentUrl: "" }] }, viewer));
});
