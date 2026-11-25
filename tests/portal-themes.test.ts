import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as designTools from "../lib/portal-design.ts";
import * as themeTools from "../lib/portal-themes.ts";

test("every library template is valid and older saved portals retain their draft and live theme", () => {
  assert.equal(themeTools.portalTemplates.length, 6);
  for (const template of themeTools.portalTemplates) assert.equal(designTools.portalDesignSchema.safeParse(themeTools.createPortalTemplate(template.id)).success, true);
  const old: designTools.PortalDesignView = { draft: designTools.defaultPortalDesign("Existing brand"), published: designTools.defaultPortalDesign("Live brand"), revision: 8, updatedAt: null, publishedAt: null };
  assert.equal(themeTools.portalLibraryThemes(old)[0].design.brandName, "Existing brand");
  assert.equal(themeTools.livePortalThemeId(old), "current");
  assert.throws(() => themeTools.createPortalTemplate("not-a-template"));
});

test("customer pages retain order, remove hidden destinations and generate scoped route URLs", () => {
  const design = designTools.defaultPortalDesign();
  design.sections.find(s => s.type === "invoice")!.enabled = false;
  design.sections.push({ id: "care", type: "content", title: "Product care", body: "Care information", enabled: true });
  const pages = themeTools.portalPages(design);
  assert.equal(pages[0].id, "home");
  assert.equal(pages.some(page => page.id === "billing"), false);
  assert.equal(pages.at(-1)?.id, "pages/care");
  assert.equal(themeTools.portalPages(design, true).find(page => page.id === "billing")?.enabled, false);
  assert.equal(themeTools.portalPageHref("invoice-id", "home"), "/customer/invoices/invoice-id");
  assert.equal(themeTools.portalPageHref("invoice-id", "pages/care"), "/customer/invoices/invoice-id/pages/care");
});

type Row = { draft: designTools.PortalDesign; published: designTools.PortalDesign | null; revision: number; updated_at: string; published_at: string | null; themes: designTools.PortalSavedTheme[]; live_theme_id: string | null };
function dataModule() {
  let row: Row | null = null;
  const db = { from: () => {
    let mutation: Partial<Row> | null = null;
    let revision: number | undefined;
    const chain = {
      select: () => chain,
      insert: (input: Row) => { mutation = input; return chain; },
      update: (input: Row) => { mutation = input; return chain; },
      eq: (key: string, value: unknown) => { if (key === "revision") revision = value as number; return chain; },
      maybeSingle: async () => {
        if (mutation) {
          if (revision !== undefined && revision !== row?.revision) return { data: null, error: null };
          row = structuredClone({ ...row, ...mutation }) as Row;
        }
        return { data: row ? structuredClone(row) : null, error: null };
      },
    };
    return chain;
  } };
  const deps: Record<string, unknown> = { "server-only": {}, "../supabase/admin": { createSupabaseAdmin: () => db }, "../portal-design": designTools, "../portal-themes": themeTools };
  const require = createRequire(import.meta.url);
  const exports = {} as typeof import("../lib/data/portal-design.ts");
  const code = ts.transpileModule(readFileSync("lib/data/portal-design.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, crypto, console, require: (name: string) => deps[name] ?? require(name) });
  return { api: exports, row: () => row };
}

test("themes save independently, publishing selects one snapshot, and draft edits leave live data unchanged", async () => {
  const { api } = dataModule();
  const first = await api.addPortalTheme(0, "admin", { templateId: "studio" });
  assert.equal(first.saved.themes?.length, 2);
  assert.equal(first.saved.published, null);
  const second = await api.addPortalTheme(first.saved.revision, "admin", { templateId: "bloom" });
  const studio = second.saved.themes!.find(theme => theme.id === first.themeId)!;
  const live = await api.savePortalDesign(studio.design, second.saved.revision, true, "admin", studio.id, "Studio live");
  assert.equal(live.liveThemeId, studio.id);
  const edited = { ...studio.design, heading: "An unpublished change", sections: studio.design.sections.map((section, index) => index ? section : { ...section, website: { html: "<h1>My website</h1>", css: "h1{color:green}" } }) };
  const saved = await api.savePortalDesign(edited, live.revision, false, "admin", studio.id, "Studio live");
  assert.notEqual(saved.published?.heading, "An unpublished change");
  assert.equal(saved.draft.sections[0].website?.html, "<h1>My website</h1>");
  assert.equal(saved.published?.sections[0].website, undefined);
  assert.equal((await api.getPublishedPortalDesign()).heading, studio.design.heading);
  const bloom = saved.themes!.find(theme => theme.id === second.themeId)!;
  assert.equal(bloom.design.theme, "soft");
  assert.equal(bloom.design.heading, second.saved.themes!.find(theme => theme.id === second.themeId)!.design.heading);
  const published = await api.savePortalDesign(bloom.design, saved.revision, true, "admin", bloom.id);
  assert.equal(published.liveThemeId, bloom.id); assert.equal(published.published?.theme, "soft");
  await assert.rejects(api.savePortalDesign(edited, live.revision, true, "admin", studio.id), /Someone else updated/);
});

test("duplicating a theme creates an independent draft and missing theme IDs cannot be edited", async () => {
  const { api } = dataModule();
  const first = await api.addPortalTheme(0, "admin", { templateId: "forma" });
  const copy = await api.addPortalTheme(first.saved.revision, "admin", { sourceId: first.themeId });
  assert.notEqual(copy.themeId, first.themeId);
  assert.equal(copy.saved.themes!.find(theme => theme.id === copy.themeId)?.name, "Forma copy");
  const source = copy.saved.themes!.find(theme => theme.id === first.themeId)!;
  const edited = await api.savePortalDesign({ ...source.design, heading: "Changed copy" }, copy.saved.revision, false, "admin", copy.themeId);
  assert.equal(edited.themes!.find(theme => theme.id === first.themeId)?.design.heading, source.design.heading);
  await assert.rejects(api.savePortalDesign(source.design, edited.revision, false, "admin", "missing"), /no longer/);
});
