// Disposable integration fixtures only. No real files are imported or changed.
// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-documents.ts
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseControl } from "../lib/supabase/control.ts";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { withWorkspaceContext } from "../lib/workspace-context.ts";
import { mutateDocument } from "../lib/data/documents.ts";
import { DOCUMENT_BUCKET } from "../lib/documents.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

const origin = process.env.DOCUMENT_TEST_ORIGIN || "http://localhost:3000";
const control = createSupabaseControl();
const { data: workspace } = await control.from("workspaces").select("id,owner_id").eq("is_legacy", true).single().throwOnError();
assert.ok(workspace);
const { data: user } = await control.auth.admin.getUserById(workspace.owner_id);
assert.ok(user.user?.email);
const { data: link, error: linkError } = await control.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
assert.ifError(linkError); assert.ok(link.properties?.hashed_token);
const jar = new Map<string, string>();
const publicKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, publicKey, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cookies => cookies.forEach(({ name, value }) => jar.set(name, value)) } });
assert.ifError((await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" })).error);
jar.set("crm_workspace", workspace.id);
const headers = { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), Origin: origin, "Content-Type": "application/json" };
const ids: string[] = []; const catalogIds: string[] = []; let folderId: string | undefined; let uploadPath: string | undefined;
const fixture = `Library verification ${crypto.randomUUID().slice(0, 8)}`;
async function retryCleanup(work: () => Promise<unknown>) {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); } catch (error) { if (attempt >= 2) throw error; }
  }
}
async function post(value: unknown, status = 200, extraHeaders = {}) {
  const response = await fetch(`${origin}/api/documents`, { method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(value), signal: AbortSignal.timeout(90000) });
  const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
}
async function get(path: string) {
  const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(90000) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
try {
  if (process.argv.includes("--email-templates")) {
    const shared = await get("/api/documents?view=templates&category=promotion");
    assert.ok(shared.documents.length >= 6);
    assert.ok(shared.documents.every((item: { origin: string; category: string }) => item.origin === "builtin" && item.category === "promotion"));
    const builtin = shared.documents[0];
    const details = await get(`/api/documents/${builtin.id}?details=1`);
    assert.ok(details.document.email_design); assert.deepEqual(details.related, []);
    for (const action of ["update", "trash", "restore", "star"]) await post({ ...builtin, action, starred: true }, 403);
    const id = crypto.randomUUID(); ids.push(id);
    const copy = (await post({ ...details.document, id, action: "create", name: fixture, category: "promotion" })).document;
    assert.equal(copy.category, "everyday"); assert.equal(copy.created_by, workspace.owner_id);
    assert.deepEqual(copy.email_design, details.document.email_design);
    assert.ok(builtin.preview_url, "Original template preview must use the bundled upstream HTML");
    const original = await fetch(origin + builtin.preview_url, { signal: AbortSignal.timeout(90000) });
    assert.equal(original.status, 200); assert.match(await original.text(), /<html/i);
    const custom = await get(`/api/documents?view=templates&category=everyday&q=${encodeURIComponent(fixture)}`);
    assert.deepEqual(custom.documents.map((item: { id: string }) => item.id), [id]);
    assert.equal((await get(`/api/documents?view=templates&category=promotion&q=${encodeURIComponent(fixture)}`)).total, 0);
    const snapshot = await get("/api/documents?bootstrap=1&view=templates&category=promotion");
    assert.deepEqual(snapshot.documents.map((item: { id: string }) => item.id).sort(), shared.documents.map((item: { id: string }) => item.id).sort());
    for (const category of ["promotion", "everyday"]) {
      const response = await fetch(`${origin}/documents?category=${category}`, { headers, signal: AbortSignal.timeout(90000) });
      assert.equal(response.status, 200);
      const html = await response.text(); assert.ok(html.includes(category === "promotion" ? builtin.name : fixture));
    }
    await withWorkspaceContext(crypto.randomUUID(), async () => {
      const result = await createSupabaseAdmin().from("library_documents").select("id").eq("id", id);
      assert.ok(result.error || !result.data?.length, "Custom templates must remain private to their workspace");
    });
    console.log("PASS: shared prebuilt catalog, read-only API protection, editable workspace copies, Custom emails filtering, bootstrap parity, page rendering and live workspace isolation.");
  } else if (process.argv.includes("--connected")) {
    const context = await get("/api/documents/context");
    assert.ok(context.companies.length && context.products.length, "Need real CRM customer and product options");
    await post({ action: "create", id: crypto.randomUUID(), kind: "file", name: "Unlinked quotation.pdf", category: "quotation" }, 400);
    await post({ action: "create", id: crypto.randomUUID(), kind: "file", name: "Unlinked invoice.pdf", category: "proforma" }, 400);
    const product = context.products.find((item: { sku: string; name: string }) => !item.sku.startsWith("SAMPLE-") && !item.name.toLowerCase().startsWith("[sample]"));
    assert.ok(product);
    const created = await fetch(`${origin}/api/documents/quotation`, { method: "POST", headers, body: JSON.stringify({ companyId: context.companies[0].id, productSkus: [product.sku], currency: product.currency }) });
    const quote = await created.json(); assert.equal(created.status, 200, JSON.stringify(quote)); catalogIds.push(quote.id);
    assert.equal(quote.href, `/company-quotations/${quote.id}`);
    const reference = `Q-${quote.id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const found = await get(`/api/documents?category=quotation&q=${reference}`);
    const entry = found.documents.find((item: { source_id: string }) => item.source_id === quote.id);
    assert.ok(entry, "Product selection must automatically appear in quotations");
    assert.deepEqual(entry.product_skus, [product.sku]); assert.equal(entry.company_id, context.companies[0].id);
    const document = await get(`/api/documents/${entry.id}?details=1`);
    assert.equal(document.document.source_type, "quotation");
    await post({ action: "trash", id: entry.id }, 409);
    const quotePdf = await get(`/api/documents/${entry.id}`);
    assert.ok(quotePdf.url.startsWith(`/api/catalogs/${quote.id}/`));
    const drafts = await get("/api/documents?category=proforma");
    const draft = drafts.documents.find((item: { source_type: string }) => item.source_type === "invoice");
    assert.ok(draft?.purchase_order_id, "Existing order invoices must appear automatically");
    const signed = await get(`/api/documents/${draft.id}`);
    const pdf = await fetch(origin + signed.url, { headers, signal: AbortSignal.timeout(90000) });
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get("content-type") || "", /application\/pdf/);
    const bytes = new Uint8Array(await pdf.arrayBuffer()); assert.ok(bytes.byteLength > 100);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
    const attachments = await get("/api/documents?view=all&kind=file&attachable=1");
    assert.ok(attachments.documents.every((item: { mime_type: string }) => item.mime_type !== "application/x-filazoo-record"));
    console.log("PASS: category-specific connection validation, product quotation creation, automatic library indexing, source edit protection, existing draft invoice discovery, authenticated live PDF rendering and attachment filtering.");
  } else if (process.argv.includes("--interface")) {
    const page = await fetch(`${origin}/documents`, { headers, signal: AbortSignal.timeout(90000) });
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const label of ["Business documents", "Shared resources", "Email library", "Custom emails"]) assert.ok(html.includes(label), `Missing library interface: ${label}`);
    assert.ok(!html.includes('class="library-ai-search"'));
    assert.ok(!html.includes('class="library-list-footer"'));
    assert.match(html, /<table[^>]*class="[^"]*crm-table/);
    assert.ok(html.includes('data-slot="table-header"'));
    assert.ok(html.includes('data-slot="table-body"'));
    assert.ok(!html.includes('class="library-table-header"'));
    assert.ok(html.includes('class="crm-table-filter-bar"'));
    assert.ok(html.includes('class="crm-table-filter crm-table-filter-search"'));
    for (const label of ["Search library", "File type", "Sort files", "Refresh files", "List view", "Grid view"]) assert.ok(html.includes(`aria-label="${label}"`), `Missing shared table control: ${label}`);
    assert.ok(!html.includes('aria-label="Filter by customer"'));
    for (const legacy of ["library-search", "library-filterbar", "library-files-heading", "library-view-controls", "library-type-tabs"]) assert.ok(!html.includes(`class="${legacy}"`), `Legacy table control remains: ${legacy}`);
    const removedSearch = await fetch(`${origin}/api/documents/search`, { method: "POST", headers, signal: AbortSignal.timeout(90000) });
    assert.ok([404, 405].includes(removedSearch.status), `Removed search handler still accepts requests: ${removedSearch.status}`);
    assert.ok(!html.includes("Everything in its place."));
    const email = await fetch(`${origin}/email`, { headers, signal: AbortSignal.timeout(90000) });
    assert.equal(email.status, 200); assert.ok(!(await email.text()).includes("Internal Server Error"));
    for (const path of ["/companies", "/products", "/company-quotations", "/invoices", "/purchase-orders", "/purchase-orders/drafts", "/lead-channel/meta", "/lead-channel/ai-leads"]) {
      const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(90000) });
      assert.equal(response.status, 200, path);
      const markup = await response.text();
      assert.ok(!/>Apply filters<|>Apply filter</.test(markup), `Manual filter button remains on ${path}`);
      assert.ok(!markup.includes("Internal Server Error"), path);
    }
    console.log("PASS: document and email routes render, shared CRM table and toolbar are present, legacy controls and bottom panels removed.");
  } else {
  assert.equal((await fetch(`${origin}/api/documents`)).status, 401);
  await post({ action: "folder", name: fixture }, 403, { Origin: "https://unrelated.invalid" });
  folderId = (await post({ action: "folder", name: fixture, color: "blue" })).folder.id;
  const id = crypto.randomUUID(); ids.push(id);
  const input = { action: "create", id, kind: "template", category: "everyday", name: fixture, folder_id: folderId, company: "Verification company", tags: ["verify-tag"], subject: "Hello", body: "Unique searchable 目录 template content" };
  let document = (await post(input)).document;
  for (const q of [fixture, "verify-tag", "Verification company", "目录"]) {
    const result = await get(`/api/documents?${new URLSearchParams({ q })}`);
    assert.ok(result.documents.some((item: { id: string }) => item.id === id), `Search failed for ${q}`);
  }
  await post({ action: "star", id, starred: true });
  assert.ok((await get("/api/documents?view=starred")).documents.some((item: { id: string }) => item.id === id));
  const before = document.updated_at;
  document = (await post({ ...input, action: "update", name: fixture + " edited", updated_at: before })).document;
  await post({ ...input, action: "update", updated_at: before }, 409);
  document = (await post({ action: "trash", id, updated_at: document.updated_at })).document;
  assert.equal((await get(`/api/documents?q=${encodeURIComponent(fixture)}`)).total, 0);
  assert.ok((await get(`/api/documents?view=trash&q=${encodeURIComponent(fixture)}`)).documents.some((item: { id: string }) => item.id === id));
  document = (await post({ action: "restore", id, updated_at: document.updated_at })).document;
  assert.equal(document.deleted_at, null);
  await post({ action: "prepare_upload", size: 52428801 }, 400);
  const signed = await post({ action: "prepare_upload", size: 28 }); uploadPath = signed.path; ids.push(signed.id);
  const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  assert.ifError((await anonymous.storage.from(DOCUMENT_BUCKET).uploadToSignedUrl(signed.path, signed.token, png, { contentType: "image/png" })).error);
  const file = (await post({ action: "create", id: signed.id, kind: "file", name: fixture + ".png", folder_id: folderId })).document;
  assert.equal(file.size, png.byteLength); assert.equal(file.mime_type, "image/png");
  const retry = (await post({ action: "create", id: signed.id, kind: "file", name: fixture + ".png", folder_id: folderId })).document;
  assert.equal(retry.id, file.id, "Retry must return the saved upload instead of duplicating it");
  await post({ action: "create", id: signed.id, kind: "file", name: "Different details.png", folder_id: folderId }, 409);
  document = (await post({ ...input, action: "update", updated_at: document.updated_at, related_ids: [file.id], category: "promotion" })).document;
  const linked = await get(`/api/documents/${id}?details=1`);
  assert.equal(linked.related[0].id, file.id);
  assert.ok((await get(`/api/documents?category=everyday&q=${encodeURIComponent(fixture)}`)).documents.some((item: { id: string }) => item.id === id));
  assert.equal((await get(`/api/documents?category=datasheet&q=${encodeURIComponent(fixture)}`)).total, 0);
  assert.equal((await get(`/api/documents?company=Verification&q=${encodeURIComponent(fixture)}`)).total, 1);
  await post({ ...input, action: "update", updated_at: document.updated_at, related_ids: [crypto.randomUUID()] }, 400);
  const preview = await get(`/api/documents/${signed.id}`);
  assert.equal((await fetch(preview.url)).status, 200);
  const download = await get(`/api/documents/${signed.id}?download=1`);
  const downloadResponse = await fetch(download.url);
  assert.equal(downloadResponse.status, 200); assert.ok(downloadResponse.headers.get("content-disposition")?.includes("attachment"));
  assert.notEqual((await anonymous.storage.from(DOCUMENT_BUCKET).download(signed.path)).error, null);
  assert.notEqual((await anonymous.from("library_documents").select("id")).error, null);
  await assert.rejects(mutateDocument({ id: workspace.owner_id, workspaceId: workspace.id, role: "viewer" } as WorkspaceViewer, { action: "folder", name: fixture }), /read-only/);
  await withWorkspaceContext(crypto.randomUUID(), async () => {
    const result = await createSupabaseAdmin().from("library_documents").select("id").eq("id", id);
    assert.ok(result.error || !result.data?.length, "Other workspaces must not read a document");
  });
  console.log("PASS: authenticated upload/download, private storage, folders, categories, customer filters, related attachments, multilingual search, favorites, edit conflicts, trash/restore, viewer permissions and workspace isolation.");
  }
} finally {
  await withWorkspaceContext(workspace.id, async () => {
    const db = createSupabaseAdmin();
    if (catalogIds.length) {
      for (const catalogId of catalogIds) await retryCleanup(async () => db.from("events").delete().eq("data->>catalogId", catalogId).throwOnError());
      await retryCleanup(async () => db.from("catalogs").delete().in("id", catalogIds).throwOnError());
      const removed = await db.from("library_documents").select("id").in("source_id", catalogIds);
      assert.ifError(removed.error); assert.equal(removed.data?.length, 0, "Source index must be cleaned automatically");
    }
    if (ids.length) { await retryCleanup(async () => db.from("document_stars").delete().in("document_id", ids).throwOnError()); await retryCleanup(async () => db.from("library_documents").delete().in("id", ids).throwOnError()); }
    if (uploadPath) await retryCleanup(async () => { assert.ifError((await db.storage.from(DOCUMENT_BUCKET).remove([uploadPath!])).error); });
    if (folderId) await retryCleanup(async () => db.from("document_folders").delete().eq("id", folderId!).throwOnError());
  });
  await client.auth.signOut({ scope: "local" });
  console.log("Removed this run's disposable fixtures.");
}
