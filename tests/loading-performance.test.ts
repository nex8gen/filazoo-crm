import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

function mount(file: string, name: string, props: Record<string, unknown>, fetcher: typeof fetch = fetch) {
  const state: unknown[] = [];
  let cursor = 0;
  let effects: Array<() => (() => void) | undefined> = [];
  let cleanups: Array<(() => void) | undefined> = [];
  let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
  let renderedDesigns = 0;
  const components = new Proxy({}, { get: (_, key) => String(key) });
  const dependencies: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useRef: () => ({ current: {} }),
      useMemo: (fn: () => unknown) => fn(),
      useEffect: (fn: () => (() => void) | undefined) => { effects.push(fn); },
    },
    "react/jsx-runtime": { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }) },
    "next/dynamic": { default: () => "DeferredComponent" },
    "@/lib/documents": { canPreviewDocument: () => false, isBuiltinEmailTemplate: () => false, documentCategories: [], formatDocumentSize: () => "1 KB" },
    "@/lib/document-connections": { documentSourceHref: () => null, documentSizeLabel: () => "1 KB" },
    "@/lib/email-design": { renderEmailDesign: () => { renderedDesigns++; return { html: "<p>Design preview</p>" }; } },
  };
  const exports: Record<string, (props: Record<string, unknown>) => unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports, fetch: fetcher, AbortController, Date, Intl,
    require: (key: string) => dependencies[key] ?? components,
    IntersectionObserver: class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() {}
      disconnect() {}
    },
  });
  function render() { cursor = 0; effects = []; return exports[name](props); }
  render();
  cleanups = effects.map(effect => effect());
  return { render, visible: () => intersect([{ isIntersecting: true }]), renderedDesigns: () => renderedDesigns, unmount: () => { cleanups.forEach(cleanup => cleanup?.()); } };
}

const document = {
  id: "template-1", name: "Customer welcome", kind: "template", mime_type: "text/plain",
  design_version: 1, email_design: null, related_ids: ["file-1"], tags: [],
  updated_at: "2026-11-17T00:00:00Z", deleted_at: null, body: "Welcome", size: 100,
};
const props = (item: typeof document | null) => ({ document: item, folders: [], canWrite: false });
const flush = () => new Promise(resolve => setImmediate(resolve));

test("a document's design and related attachments share one details request", async () => {
  const calls: string[] = [];
  const app = mount("document-preview", "DocumentPreview", props(document), async (input) => {
    calls.push(String(input));
    return Response.json({ document: { ...document, email_design: { blocks: [] } }, related: [{ id: "file-1", name: "Product sheet" }] });
  });
  await flush();
  assert.deepEqual(calls, ["/api/documents/template-1?details=1"]);
  const tree = elements(app.render());
  assert.ok(tree.some(element => element.type === "iframe" && element.props.srcDoc === "<p>Design preview</p>"));
  assert.ok(tree.some(element => element.props.children === "Product sheet"));
  app.unmount();
});

test("empty and trashed document previews do not request details", () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
  for (const item of [null, { ...document, deleted_at: "2026-11-17T01:00:00Z" }]) {
    const app = mount("document-preview", "DocumentPreview", props(item), fetcher);
    assert.equal(calls, 0);
    app.unmount();
  }
});

test("closing a document preview aborts its request and discards a late response", async () => {
  let signal: AbortSignal | undefined;
  let release: (response: Response) => void = () => {};
  const response = new Promise<Response>(resolve => { release = resolve; });
  const app = mount("document-preview", "DocumentPreview", props(document), async (_input, init) => {
    signal = init?.signal ?? undefined;
    return response;
  });
  app.unmount();
  assert.equal(signal?.aborted, true);
  release(Response.json({ document: { ...document, email_design: {} }, related: [{ id: "late", name: "Late attachment" }] }));
  await flush();
  assert.equal(elements(app.render()).some(element => element.type === "iframe" || element.props.children === "Late attachment"), false);
});

test("offscreen template cards defer HTML generation until they approach the viewport", () => {
  const app = mount("document-template-card", "DocumentTemplateCard", {
    document: { ...document, email_design: { blocks: [] } }, workspaceName: "Test workspace",
  });
  assert.equal(app.renderedDesigns(), 0);
  assert.equal(elements(app.render()).some(element => element.type === "iframe"), false);
  app.visible();
  assert.ok(elements(app.render()).some(element => element.type === "iframe" && element.props.srcDoc === "<p>Design preview</p>"));
  assert.equal(app.renderedDesigns(), 1);
  app.unmount();
});
