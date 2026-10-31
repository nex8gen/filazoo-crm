// Isolated live-database fixtures; no customer email or automation is enabled.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

nextEnv.loadEnvConfig(process.cwd());
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const originIndex = process.argv.indexOf("--origin");
const origin = (originIndex >= 0 ? process.argv[originIndex + 1] : process.env.PRODUCT_TEST_ORIGIN) || "http://127.0.0.1:3000";
const fixturePath = path.resolve("tmp/private-products-fixture.json");
const require = createRequire(import.meta.url);
let viewer;
const stubs = { "server-only": {}, "next/cache": { revalidatePath() {} },
  "@/lib/auth": { requireWorkspaceMember: async () => viewer, getWorkspaceViewer: async () => viewer },
  "@/lib/supabase/admin": { createSupabaseAdmin: () => db },
  "@/lib/data/flow-runtime": {}, "@/lib/lead-assignment": {},
};
const loaded = new Map();
function load(file) {
  const resolved = path.resolve(file);
  if (loaded.has(resolved)) return loaded.get(resolved);
  const exports = {};
  loaded.set(resolved, exports);
  const code = ts.transpileModule(readFileSync(resolved, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  function localRequire(name) {
    if (name in stubs) return stubs[name];
    if (name.endsWith("/auth") || name.endsWith("/auth.ts")) return stubs["@/lib/auth"];
    if (name.endsWith("/supabase/admin") || name.endsWith("/supabase/admin.ts")) return stubs["@/lib/supabase/admin"];
    if (name.startsWith(".") || name.startsWith("@/")) {
      let dependency = name.startsWith("@/") ? path.resolve(name.slice(2)) : path.resolve(path.dirname(resolved), name);
      if (!existsSync(dependency)) dependency += existsSync(dependency + ".ts") ? ".ts" : ".tsx";
      return load(dependency);
    }
    return require(name);
  }
  vm.runInNewContext(code, { exports, require: localRequire, process, Buffer, URL, Request, Response, FormData, Blob, Date, Intl, Error, TextEncoder, TextDecoder, Uint8Array, crypto: globalThis.crypto, fetch, AbortSignal, console }, { filename: resolved });
  return exports;
}
async function clean(fixture) {
  const pending = [];
  for (const owner of fixture.users) {
    const paths = await db.storage.from("company-catalog-pdfs").list(owner.id);
    for (const directory of paths.data ?? []) {
      const files = await db.storage.from("company-catalog-pdfs").list(`${owner.id}/${directory.name}`);
      if (files.data?.length) await db.storage.from("company-catalog-pdfs").remove(files.data.map((file) => `${owner.id}/${directory.name}/${file.name}`));
    }
    const images = await db.storage.from("user-product-images").list(owner.id);
    if (images.data?.length) await db.storage.from("user-product-images").remove(images.data.map((file) => `${owner.id}/${file.name}`));
    const removedCatalogs = await db.from("catalogs").delete().eq("user_id", owner.id).eq("company_id", fixture.companyId);
    if (removedCatalogs.error) throw removedCatalogs.error;
    const removedEvents = await db.from("events").delete().eq("actor_id", owner.id).eq("company_id", fixture.companyId);
    if (removedEvents.error) throw removedEvents.error;
    const removedFlows = await db.from("flows").delete().eq("user_id", owner.id).eq("created_by", owner.id);
    if (removedFlows.error) throw removedFlows.error;
    const removedOverrides = await db.from("user_product_overrides").delete().eq("user_id", owner.id);
    if (removedOverrides.error) throw removedOverrides.error;
    const removedMember = await db.from("workspace_members").delete().eq("user_id", owner.id).eq("display_name", owner.displayName);
    if (removedMember.error) throw removedMember.error;
    const result = await db.auth.admin.deleteUser(owner.id);
    if (result.error && result.error.status !== 404) pending.push(owner.id);
  }
  if (fixture.companyId) await db.from("companies").delete().eq("id", fixture.companyId).like("name", "Product privacy verification%");
  if (pending.length) {
    assert.ok(pending.every((id) => /^[a-f0-9-]{36}$/.test(id)));
    await writeFile("tmp/private-products-auth-cleanup.sql", `delete from auth.users where id in (${pending.map(id => `'${id}'`).join(",")}) and email like 'private-products-%@example.test';\n`);
    console.log("Test storage and public records removed. Auth service refused deletion; run tmp/private-products-auth-cleanup.sql through the database connector, then rerun --cleanup.");
  }
  return pending.length === 0;
}
if (process.argv.includes("--cleanup")) {
  if (!await clean(JSON.parse(await readFile(fixturePath, "utf8")))) process.exit(1);
  await unlink(fixturePath);
  console.log("Private product test users, edits, catalogs, uploads, and company removed.");
  process.exit(0);
}
if (process.argv.includes("--http-only")) {
  const saved = JSON.parse(await readFile(fixturePath, "utf8"));
  await verifyHttp(saved);
  await writeFile(fixturePath, JSON.stringify(saved));
  console.log("PASS: actual HTTP owner PDF/photo access, cross-account denial, anonymous denial and personalized product page.");
  process.exit(0);
}
assert.equal(existsSync(fixturePath), false, "Clean up an earlier verification before starting another.");
await mkdir(path.dirname(fixturePath), { recursive: true });
const fixture = { users: [], companyId: null };
await writeFile(fixturePath, JSON.stringify(fixture));
let retained = false;
async function persist() { await writeFile(fixturePath, JSON.stringify(fixture)); }
function ok(result) { if (result.error) throw result.error; return result.data; }
async function verifyHttp(saved) {
  const catalog = ok(await db.from("catalogs").select("id").eq("user_id", saved.users[0].id).eq("company_id", saved.companyId).order("version", { ascending: false }).limit(1).single());
  const product = ok(await db.from("user_product_overrides").select("data").eq("user_id", saved.users[0].id).eq("product_sku", "ABS").single());
  async function login(user) {
    const link = ok(await db.auth.admin.generateLink({ type: "magiclink", email: user.email }));
    const cookies = new Map();
    const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: (values) => values.forEach(({ name, value }) => cookies.set(name, value)) } });
    ok(await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }));
    return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  const aCookie = await login(saved.users[0]), bCookie = await login(saved.users[1]);
  const endpoint = `/api/catalogs/${catalog.id}/pdf`;
  const ownResponse = await fetch(origin + endpoint, { headers: { Cookie: aCookie }, redirect: "manual" });
  assert.equal(ownResponse.status, 200, await ownResponse.clone().text());
  assert.equal((await fetch(origin + endpoint, { headers: { Cookie: bCookie }, redirect: "manual" })).status, 404);
  assert.equal((await fetch(origin + endpoint, { redirect: "manual" })).status, 401);
  assert.equal((await fetch(origin + product.data.image_url, { headers: { Cookie: aCookie }, redirect: "manual" })).status, 200);
  assert.equal((await fetch(origin + product.data.image_url, { headers: { Cookie: bCookie }, redirect: "manual" })).status, 404);
  const page = await fetch(origin + "/products/ABS", { headers: { Cookie: aCookie } });
  assert.equal(page.status, 200); assert.ok((await page.text()).includes("Private ABS A updated"));
  saved.catalogId = catalog.id;
  saved.browserUrl = origin + "/products/ABS";
  const browserLink = ok(await db.auth.admin.generateLink({ type: "magiclink", email: saved.users[0].email }));
  saved.loginUrl = `${origin}/auth/confirm?type=magiclink&token_hash=${browserLink.properties.hashed_token}&next=/products/ABS`;
}
try {
  for (const label of ["A", "B"]) {
    const email = `private-products-${randomUUID()}@example.test`;
    const user = ok(await db.auth.admin.createUser({ email, email_confirm: true })).user;
    fixture.users.push({ id: user.id, email, role: "viewer", displayName: `Product Privacy ${label}` }); await persist();
    ok(await db.from("workspace_members").upsert({ user_id: user.id, role: "viewer", activated_at: new Date().toISOString(), display_name: `Product Privacy ${label}`, auto_assign_leads: false }));
  }
  const company = ok(await db.from("companies").insert({ name: `Product privacy verification ${randomUUID()}`, source: "manual", country: "Test", segment: "Test" }).select("id").single());
  fixture.companyId = company.id; await persist();
  const personal = load("lib/data/product-personalization.ts");
  const productUtils = load("lib/product-utils.ts");
  stubs["@/lib/data/crm"] = { listProducts: async (skus) => ({ mode: "live", products: (await personal.userProductRows(viewer.id, skus)).map(productUtils.crmProduct) }) };
  const actions = load("app/crm-actions.ts");
  load("lib/data/catalog-pdfs.ts");
  const flows = load("lib/data/flow-ai-reply.ts");
  const [baseline] = ok(await db.from("products").select("*").eq("sku", "ABS"));
  assert.ok(baseline);
  async function productForm(price, name) {
    const [row] = await personal.userProductRows(viewer.id, ["ABS"]);
    const form = new FormData();
    Object.entries({ originalSku: "ABS", sku: "ABS", name, material: "ABS", diameter: "1.75 mm", weight: "1 kg", currency: "USD", minimum1: "1", price1: String(price), minimum2: "20", price2: "6.46", minimum3: "200", price3: "6.20", stockStatus: "Private stock note", leadTime: "Private lead time", imageUrl: row.image_url || "", active: "true", overrideVersion: row.override_version || "", variants: JSON.stringify(productUtils.variantsFromTags(row.tags ?? [], [], "ABS", "$7.09", "Quote available")) }).forEach(([key, value]) => form.set(key, value));
    return form;
  }
  viewer = fixture.users[0];
  const aForm = await productForm(8, "Private ABS A");
  assert.ok((await actions.updateProduct(undefined, aForm)).success);
  assert.match((await actions.updateProduct(undefined, aForm)).error, /another tab/);
  viewer = fixture.users[1];
  assert.equal((await personal.userProductRows(viewer.id, ["ABS"]))[0].price, baseline.price);
  assert.ok((await actions.updateProduct(undefined, await productForm(9, "Private ABS B"))).success);
  viewer = fixture.users[0];
  assert.equal(Number((await personal.userProductRows(viewer.id, ["ABS"]))[0].price), 8);
  const bytes = await sharp({ create: { width: 90, height: 70, channels: 3, background: "#6633cc" } }).png().toBuffer();
  const upload = await load("app/product-image-actions.ts").prepareProductImageUpload("image/png", bytes.length);
  assert.ok(upload.token, upload.error);
  ok(await db.storage.from("user-product-images").uploadToSignedUrl(upload.path, upload.token, bytes, { contentType: "image/png" }));
  fixture.imagePath = upload.path;
  const photoForm = await productForm(8, "Private ABS A"); photoForm.set("imageUrl", upload.imageUrl);
  const variants = JSON.parse(photoForm.get("variants")); variants[0].imageUrl = upload.imageUrl; variants[1].price = "$8.75";
  photoForm.set("variants", JSON.stringify(variants));
  assert.ok((await actions.updateProduct(undefined, photoForm)).success);
  console.log("PASS: independent edits, stale saves, and private photo upload.");
  const imageRoute = load("app/api/product-images/[userId]/[filename]/route.ts");
  const imageParams = { params: Promise.resolve({ userId: viewer.id, filename: upload.path.split("/")[1] }) };
  assert.equal((await imageRoute.GET(new Request(origin), imageParams)).status, 200);
  viewer = fixture.users[1]; assert.equal((await imageRoute.GET(new Request(origin), imageParams)).status, 404);
  viewer = fixture.users[0];
  const form = new FormData(); form.set("companyId", company.id); form.set("currency", "USD"); form.append("productSkus", "ABS");
  const result = await actions.createCatalog(undefined, form); assert.ok(result.success, result.error);
  const catalog = ok(await db.from("catalogs").select("*").eq("user_id", viewer.id).eq("company_id", company.id).single());
  fixture.catalogId = catalog.id;
  const route = load("app/api/catalogs/[id]/pdf/route.ts");
  const response = await route.GET(new Request(`${origin}/api/catalogs/${catalog.id}/pdf`), { params: Promise.resolve({ id: catalog.id }) });
  assert.equal(response.status, 200);
  const original = Buffer.from(await response.arrayBuffer()); assert.match(original.toString("latin1"), /^%PDF-/);
  console.log("PASS: saved snapshot PDF generated.");
  assert.ok(original.includes(Buffer.from("Private ABS A")));
  assert.ok(original.includes(Buffer.from("$8.00")));
  assert.ok(original.includes(Buffer.from("/Subtype /Image")));
  await writeFile("tmp/private-products-snapshot.pdf", original);
  const ownFlow = await flows.prepareFlowTemplateCatalog(viewer.id);
  console.log("PASS: owner A full flow catalog generated.");
  assert.ok(ownFlow[0].content.includes(Buffer.from("Private ABS A")));
  assert.ok(!ownFlow[0].content.includes(Buffer.from("Private ABS B")));
  viewer = fixture.users[1];
  assert.equal((await route.GET(new Request(origin), { params: Promise.resolve({ id: catalog.id }) })).status, 404);
  const otherFlow = await flows.prepareFlowTemplateCatalog(viewer.id);
  console.log("PASS: owner B full flow catalog generated.");
  assert.ok(otherFlow[0].content.includes(Buffer.from("Private ABS B")));
  assert.ok(!otherFlow[0].content.includes(Buffer.from("Private ABS A")));
  viewer = fixture.users[0];
  assert.ok((await actions.updateProduct(undefined, await productForm(10, "Private ABS A updated"))).success);
  const unchanged = await route.GET(new Request(origin), { params: Promise.resolve({ id: catalog.id }) });
  assert.deepEqual(Buffer.from(await unchanged.arrayBuffer()), original);
  assert.ok((await db.from("catalogs").update({ user_id: fixture.users[1].id }).eq("id", catalog.id)).error);
  const { data: anonymousData, error: anonymousError } = await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).from("user_product_overrides").select();
  assert.ok(anonymousError || !anonymousData?.length);
  assert.deepEqual(ok(await db.from("products").select("*").eq("sku", "ABS"))[0], baseline);
  await verifyHttp(fixture);
  await persist();
  retained = process.argv.includes("--retain");
  console.log("PASS: two users, all-private saves, stale-save rejection, signed upload, image ownership, independent flow PDFs, immutable catalog snapshots, database guards, anonymous denial, actual HTTP session/PDF/photo access, and unchanged shared ABS.");
  if (retained) console.log("Browser fixtures retained in tmp/private-products-fixture.json for UI verification.");
} catch (error) {
  retained = true;
  console.error("Verification failed; isolated fixtures retained for diagnosis:", error);
  throw error;
} finally {
  if (!retained && await clean(fixture)) await unlink(fixturePath);
}
