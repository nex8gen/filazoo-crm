// Read-only PDF preview verification. Uses an existing PDF in the legacy
// workspace and writes only a local QA image under tmp/. Never changes files.
// node --env-file=.env.local --experimental-strip-types scripts/verify-document-preview.ts
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSupabaseControl } from "../lib/supabase/control.ts";
import { DOCUMENT_BUCKET } from "../lib/documents.ts";
import { createServerClient } from "@supabase/ssr";

const require = createRequire(import.meta.url);
const origin = "http://localhost:3000";
const db = createSupabaseControl();
const { data: workspace } = await db.from("workspaces").select("owner_id,id").eq("is_legacy", true).single().throwOnError();
assert.ok(workspace);
const { data: user } = await db.auth.admin.getUserById(workspace.owner_id); assert.ok(user.user?.email);
const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: "magiclink", email: user.user.email }); assert.ifError(linkError); assert.ok(link.properties?.hashed_token);
const jar = new Map<string, string>();
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cookies => cookies.forEach(({ name, value }) => jar.set(name, value)) } });
assert.ifError((await auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" })).error);
jar.set("crm_workspace", workspace.id);
const headers = { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
try {
for (const [url, type] of [["/api/documents/pdf-worker?v=6.5.438&build=legacy", "text/javascript"], ["/api/documents/pdf-assets/standard_fonts/FoxitFixed.pfb", "application/octet-stream"], ["/api/documents/pdf-assets/wasm/openjpeg.wasm", "application/wasm"]]) {
  const response = await fetch(origin + url, { headers, signal: AbortSignal.timeout(90000) });
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(response.headers.get("content-type")?.includes(type));
  assert.ok((await response.arrayBuffer()).byteLength > 100);
}
assert.equal((await fetch(origin + "/api/documents/pdf-assets/other/package.json", { headers })).status, 404);
const { data, error } = await db.from("library_documents").select("object_path,mime_type").eq("workspace_id", workspace.id).eq("kind", "file").is("deleted_at", null).eq("mime_type", "application/pdf").limit(1).maybeSingle();
assert.ifError(error); assert.ok(data, "An uploaded PDF is required for this read-only check.");
const signed = await db.storage.from(DOCUMENT_BUCKET).createSignedUrl(data.object_path, 60); assert.ifError(signed.error);
const response = await fetch(signed.data!.signedUrl); assert.equal(response.status, 200);
const bytes = new Uint8Array(await response.arrayBuffer());
assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
const canvasLib = await import("@napi-rs/canvas");
Object.assign(globalThis, { DOMMatrix: canvasLib.DOMMatrix, ImageData: canvasLib.ImageData, Path2D: canvasLib.Path2D });
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href;
const root = dirname(require.resolve("pdfjs-dist/package.json"));
const assetPath = (folder: string) => join(root, folder).replaceAll("\\", "/") + "/";
const task = pdfjs.getDocument({ data: bytes, disableWorkerRendering: true, standardFontDataUrl: assetPath("standard_fonts"), cMapUrl: assetPath("cmaps"), cMapPacked: true, wasmUrl: assetPath("wasm") });
const pdf = await task.promise;
const page = await pdf.getPage(1);
const viewport = page.getViewport({ scale: 1 });
const canvas = canvasLib.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
const text = await page.getTextContent();
assert.ok(text.items.length > 0);
await writeFile("tmp/library-preview-check.png", canvas.toBuffer("image/png"));
if (pdf.numPages > 1) {
  const last = await pdf.getPage(pdf.numPages);
  const lastView = last.getViewport({ scale: .5 });
  const lastCanvas = canvasLib.createCanvas(Math.ceil(lastView.width), Math.ceil(lastView.height));
  await last.render({ canvas: lastCanvas as unknown as HTMLCanvasElement, viewport: lastView }).promise;
}
console.log(JSON.stringify({ status: "PASS", pages: pdf.numPages, renderedPages: [1, pdf.numPages], width: canvas.width, height: canvas.height, textItems: text.items.length, workerAndFontRoutes: "PASS", originalFileChanged: false }));
await task.destroy();
} finally { await auth.auth.signOut({ scope: "local" }); }
