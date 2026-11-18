import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import * as rules from "../lib/ai/library-search.ts";

const source = ts.transpileModule(readFileSync(new URL("../lib/data/library-ai-search.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const routeSource = ts.transpileModule(readFileSync(new URL("../app/api/documents/search/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test("AI library lookup ranks only authorized search results and never loads files or sends mail", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const lookups: URLSearchParams[] = [], prompts: string[] = [];
  const api = {} as { searchLibraryWithAi: (viewer: unknown, query: string, kind?: string) => Promise<{ documents: Array<{ id: string }> }> };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../ai/library-search.ts": rules,
    "./ai-settings.ts": { requireAiFeature: async (...args: string[]) => { assert.ok(args.includes("billing")); } },
    "../ai/provider-credentials.ts": { resolveGatewayTokenAsync: async () => "synthetic-token" },
    "../ai/gateway.ts": { generateGatewayText: async ({ prompt }: { prompt: string }) => { prompts.push(prompt); return prompts.length === 1 ? JSON.stringify({ queries: ["catalog", "产品目录"] }) : JSON.stringify({ ids: [id], explanation: "Latest matching catalog" }); } },
    "./documents.ts": { listDocuments: async (viewer: { id: string }, params: URLSearchParams) => { assert.equal(viewer.id, "viewer"); lookups.push(params); return { documents: [{ id, name: "Catalog.pdf", kind: "file", body: "Private body must not be sent to the ranking model", description: "Approved catalog" }] }; } },
  };
  vm.runInNewContext(source, { exports: api, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key]; }, process: { env: {} }, AbortSignal, URLSearchParams });
  const result = await api.searchLibraryWithAi({ id: "viewer" }, "Find the latest product catalog", "file");
  assert.deepEqual(result.documents.map(item => item.id), [id]);
  assert.ok(lookups.every(params => params.get("attachable") === "1" && params.get("kind") === "file"));
  assert.doesNotMatch(prompts[1], /Private body/);
});

test("library AI route enforces session, request shape and origin before running the lookup", async () => {
  let signedIn = false, calls = 0;
  const api = {} as { POST: (request: Request) => Promise<Response> };
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { getWorkspaceViewer: async () => signedIn ? { id: "viewer" } : null },
    "@/lib/workspace-context": { withWorkspaceViewer: async (_viewer: unknown, work: () => unknown) => work() },
    "@/lib/ai/library-search": rules,
    "@/lib/data/library-ai-search": { searchLibraryWithAi: async () => { calls++; return { documents: [], explanation: "No matches" }; } },
  };
  vm.runInNewContext(routeSource, { exports: api, require: (key: string) => dependencies[key], Response, URL });
  const request = (body: unknown, origin = "https://crm.example.test") => new Request("https://crm.example.test/api/documents/search", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
  assert.equal((await api.POST(request({ query: "catalog" }))).status, 401);
  signedIn = true;
  assert.equal((await api.POST(request({ query: "catalog" }, "https://other.test"))).status, 403);
  assert.equal((await api.POST(request({ query: "catalog", send: true }))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await api.POST(request({ query: "catalog" }))).status, 200); assert.equal(calls, 1);
});
