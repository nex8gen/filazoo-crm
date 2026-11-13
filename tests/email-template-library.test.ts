import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import * as documents from "../lib/documents.ts";
import * as catalog from "../lib/builtin-email-templates.ts";
import { filterDocumentLibrary } from "../lib/document-library-filter.ts";
import { emailDesignSchema, emailDesignText } from "../lib/email-design.ts";
import { withWorkspaceViewer, currentWorkspaceContext } from "../lib/workspace-context.ts";
import { workspaceFetch } from "../lib/supabase/workspace-fetch.ts";
import { campaignConfigSchema, campaignMessageIssues, campaignMessageWarnings, personalizeCampaign } from "../lib/email-campaigns.ts";
import { fillLibraryTemplate } from "../lib/document-email.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

const a = { id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), role: "admin" } as WorkspaceViewer;
const b = { ...a, id: crypto.randomUUID(), workspaceId: crypto.randomUUID() } as WorkspaceViewer;
type Row = documents.LibraryDocument & { workspace_id: string; created_by: string };
function row(index: number, extra: Partial<Row> = {}): Row {
  return { id: crypto.randomUUID(), name: `Template ${String(index).padStart(4, "0")}`, kind: "template", category: "everyday", subject: "Hello", body: "Hello {{first_name}}", mime_type: "text/plain", size: 0, company: "", description: "", tags: [], folder_id: null, related_ids: [], starred: false, deleted_at: null, created_at: "2026-11-01T00:00:00Z", updated_at: new Date(Date.UTC(2026, 10, 1, index)).toISOString(), workspace_id: a.workspaceId, created_by: a.id, ...extra };
}

function backend(initial: Row[] = []) {
  const rows = structuredClone(initial);
  const calls: string[] = [];
  // Exercise the real Supabase query builder and workspace header adapter.
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), params = url.searchParams;
    const scope = new Headers(init?.headers).get("x-crm-workspace-id");
    assert.ok(scope, "Every database request must carry the authenticated workspace");
    calls.push(url.pathname);
    if (!url.pathname.endsWith("/library_documents")) return Response.json([], { headers: { "Content-Range": "0-0/0" } });
    if (init?.method === "POST") {
      const value = JSON.parse(String(init.body));
      const saved = row(rows.length, { ...value, workspace_id: scope }); rows.push(saved);
      return Response.json(saved);
    }
    let selected = rows.filter(item => item.workspace_id === scope);
    for (const [key, expression] of params) {
      if (["select", "order", "offset", "limit", "or"].includes(key)) continue;
      selected = selected.filter(item => {
        const value = item[key as keyof Row];
        if (expression === "is.null") return value == null;
        if (expression === "not.is.null") return value != null;
        if (expression.startsWith("eq.")) return String(value) === expression.slice(3);
        if (expression.startsWith("neq.")) return String(value) !== expression.slice(4);
        if (expression.startsWith("in.(")) return expression.slice(4, -1).split(",").includes(String(value));
        if (expression.startsWith("ilike.")) return String(key === "search_text" ? documents.documentSearchText(item) : value).toLowerCase().includes(expression.slice(6).replaceAll("%", "").toLowerCase());
        if (expression.startsWith("gte.")) return String(value) >= expression.slice(4);
        if (expression.startsWith("lt.")) return String(value) < expression.slice(3);
        throw new Error(`Unhandled database filter ${key}=${expression}`);
      });
    }
    const order = params.get("order") ?? "";
    selected.sort((x, y) => (order.startsWith("name") ? x.name.localeCompare(y.name) : order.startsWith("updated_at") ? (Date.parse(x.updated_at) - Date.parse(y.updated_at)) * (order.includes("updated_at.desc") ? -1 : 1) : x.id.localeCompare(y.id)) || x.id.localeCompare(y.id));
    const count = selected.length, offset = Number(params.get("offset")) || 0, limit = Number(params.get("limit")) || count;
    const headers = { "Content-Range": `0-${Math.max(0, count - 1)}/${count}` };
    if (new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object")) return Response.json(selected[0] ?? null, { headers });
    return init?.method === "HEAD" ? new Response(null, { headers }) : Response.json(selected.slice(offset, offset + limit), { headers });
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "zod": { z }, "../documents.ts": documents, "../builtin-email-templates.ts": catalog,
    "../workspace-context.ts": { withWorkspaceViewer },
    "../supabase/admin.ts": { createSupabaseAdmin: () => createClient("https://database.test", "test-secret", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: workspaceFetch(async () => currentWorkspaceContext() ?? null, fetcher) } }) },
    "./document-connections.ts": { validateDocumentConnections: async () => ({}) },
    "../document-library-filter.ts": { filterDocumentLibrary }, "../document-upload.ts": { isSameDocumentUpload: () => false },
    "../email-design.ts": { emailDesignText },
  };
  const exports = {} as typeof import("../lib/data/documents.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/documents.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, Buffer, URLSearchParams, crypto,
  });
  return { ...exports, rows, calls };
}

test("all workspaces receive the same valid prebuilt catalog and independent copies", async () => {
  const api = backend();
  const first = await api.bootstrapDocumentLibrary(a, new URLSearchParams("view=templates&category=promotion"));
  const second = await api.bootstrapDocumentLibrary(b, new URLSearchParams("view=templates&category=promotion"));
  assert.equal(first.documents.length, 16);
  assert.deepEqual(first.documents, second.documents);
  for (const template of first.documents) {
    assert.equal(template.origin, "builtin"); assert.equal(template.category, "promotion");
    assert.ok(z.uuid().safeParse(template.id).success);
    assert.ok(emailDesignSchema.safeParse(catalog.builtinEmailTemplate(template.id)!.email_design).success);
  }
  const full = catalog.builtinEmailTemplate(first.documents[0].id)!;
  full.email_design!.blocks[0].html = "Modified";
  assert.notEqual(catalog.builtinEmailTemplate(full.id)!.email_design!.blocks[0].html, "Modified");
});

test("legacy workspace templates belong to Custom emails and stay isolated", async () => {
  const mine = row(1, { category: "promotion" }), other = row(2, { workspace_id: b.workspaceId, created_by: b.id });
  const api = backend([mine, other]);
  const custom = await api.bootstrapDocumentLibrary(a, new URLSearchParams("view=templates&category=everyday"));
  assert.deepEqual(Array.from(custom.documents, item => item.id), [mine.id]);
  assert.equal(custom.documents[0].category, "everyday"); assert.equal(custom.documents[0].origin, "workspace");
  const builtin = await api.listDocuments(a, new URLSearchParams("view=templates&category=promotion"));
  assert.ok(builtin.documents.every(item => item.origin === "builtin"));
  const theirs = await api.listDocuments(b, new URLSearchParams("view=templates&category=everyday"));
  assert.deepEqual(Array.from(theirs.documents, item => item.id), [other.id]);
  await assert.rejects(api.getLibraryDocument(b, mine.id), /no longer available/);
  assert.equal((await api.getLibraryDocument(a, mine.id)).document.category, "everyday");
});

test("every prebuilt template works in campaigns and individual email personalization", () => {
  for (const entry of catalog.builtinEmailTemplates()) {
    const template = catalog.builtinEmailTemplate(entry.id)!;
    const config = campaignConfigSchema.parse({ subject: template.subject, emailDesign: template.email_design });
    const needsLinks = template.email_design!.blocks.some(block => block.type === "button" && !/^https?:/.test(block.href));
    assert.deepEqual(campaignMessageIssues(config, template.body, { id: "sender", email: "sales@example.test", name: "Sales", available: true }), []);
    assert.equal(campaignMessageWarnings(config).length, needsLinks ? 1 : 0);
    const configured = structuredClone(config);
    for (const block of configured.emailDesign!.blocks) if (block.type === "button") block.href = "https://example.test/offer";
    assert.deepEqual(campaignMessageIssues(configured, template.body, { id: "sender", email: "sales@example.test", name: "Sales", available: true }), []);
    assert.deepEqual(campaignMessageWarnings(configured), []);
    const text = template.subject + "\n" + template.body;
    assert.doesNotMatch(personalizeCampaign(text, { id: "customer", name: "Alex Chen", companyName: "Example company", email: "alex@example.test" }), /\{\{/);
    assert.doesNotMatch(fillLibraryTemplate(text, { name: "Alex Chen", company: "Example company" }), /\{\{/);
  }
});

test("all workspace template writes use Custom emails, including old clients", async () => {
  const api = backend();
  for (const category of ["promotion", "general", "everyday"]) {
    const id = crypto.randomUUID();
    await api.mutateDocument(a, { action: "create", id, kind: "template", name: "My copy", body: "Custom content", category, origin: "builtin" });
    const saved = api.rows.find(item => item.id === id)!;
    assert.equal(saved.category, "everyday"); assert.equal(saved.workspace_id, a.workspaceId); assert.equal(saved.created_by, a.id);
  }
  assert.equal((await api.listDocuments(b, new URLSearchParams("category=everyday"))).total, 0);
});

test("prebuilt templates load without workspace rows and reject direct mutations", async () => {
  const api = backend(), template = catalog.builtinEmailTemplates()[0];
  assert.equal((await api.getLibraryDocument(b, template.id)).document.id, template.id);
  for (const action of ["update", "trash", "restore", "star", "create"]) {
    await assert.rejects(api.mutateDocument(a, { action, ...template, starred: true }), (error: unknown) => (error as { status: number }).status === 403);
  }
  assert.equal(api.calls.length, 0); assert.equal(api.rows.length, 0);
  await assert.rejects(api.mutateDocument({ ...a, role: "viewer" }, { action: "create" }), /read-only/);
});

test("large-library server pages match the complete collection across catalog boundaries", async () => {
  const rows = Array.from({ length: 330 }, (_, index) => row(index, { category: index % 2 ? "promotion" : "general" }));
  const api = backend(rows);
  const snapshot: documents.LibrarySnapshot = { documents: [...catalog.builtinEmailTemplates(), ...rows.map(documents.workspaceLibraryDocument)], folders: [], stats: { files: 0, templates: rows.length + catalog.builtinEmailTemplates().length, starred: 0, trash: 0 } };
  for (const query of ["view=templates&sort=name", "view=templates&sort=newest", "view=templates&sort=oldest", "category=everyday", "category=promotion", "view=templates&q=introduction", "kind=file", "view=trash"]) {
    const params = new URLSearchParams(query);
    const full = filterDocumentLibrary(snapshot, params, 1000);
    for (const offset of [0, 60, 300, 330]) {
      params.set("offset", String(offset));
      const page = await api.listDocuments(a, params);
      assert.equal(page.total, full.total, query);
      assert.deepEqual(Array.from(page.documents, item => item.id), full.documents.slice(offset, offset + 60).map(item => item.id), `${query} offset ${offset}`);
    }
  }
  const fallback = await api.bootstrapDocumentLibrary(a, new URLSearchParams("category=promotion"));
  assert.equal(fallback.collection, null); assert.equal(fallback.total, catalog.builtinEmailTemplates().length);
});
