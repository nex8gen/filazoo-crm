import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as designTools from "../lib/portal-design.ts";
import * as themeTools from "../lib/portal-themes.ts";
import { portalWebsiteDesign } from "../lib/portal-website-design.ts";
import { createWebsiteBlock, websiteSectionBlocks } from "../lib/portal-website-blocks.ts";

test("every library template is valid and older saved portals retain their draft and live theme", () => {
  assert.equal(themeTools.portalTemplates.length, 6);
  for (const template of themeTools.portalTemplates) assert.equal(designTools.portalDesignSchema.safeParse(themeTools.createPortalTemplate(template.id)).success, true);
  const old: designTools.PortalDesignView = { draft: designTools.defaultPortalDesign("Existing brand"), published: designTools.defaultPortalDesign("Live brand"), revision: 8, updatedAt: null, publishedAt: null };
  assert.equal(themeTools.portalLibraryThemes(old)[0].design.brandName, "Existing brand");
  assert.equal(themeTools.livePortalThemeId(old), "current");
  assert.throws(() => themeTools.createPortalTemplate("not-a-template"));
  assert.equal(themeTools.livePortalThemeId({ ...old, published: null, liveThemeId: "current" }), null);
  assert.equal(new Set(themeTools.portalTemplates.map(item => JSON.stringify(themeTools.createPortalTemplate(item.id).website))).size, 6);
});

test("library rename and restore preserve published content and reject stale or invalid operations", async () => {
  const { api } = dataModule();
  const first = await api.addPortalTheme(0, "admin", { templateId: "studio" });
  const theme = first.saved.themes!.find(item => item.id === first.themeId)!;
  const live = await api.savePortalDesign(theme.design, first.saved.revision, true, "admin", theme.id);
  const changed = await api.savePortalDesign({ ...theme.design, heading: "Private draft" }, live.revision, false, "admin", theme.id);
  assert.equal(themeTools.portalThemeHasChanges(changed, theme.id), true);
  const renamed = await api.managePortalTheme(changed.revision, "admin", { themeId: theme.id, action: "rename", name: "  Autumn  " });
  assert.equal(renamed.themes!.find(item => item.id === theme.id)?.name, "Autumn");
  assert.equal(renamed.published?.heading, theme.design.heading);
  assert.equal(renamed.publishedAt, live.publishedAt);
  await assert.rejects(api.managePortalTheme(changed.revision, "admin", { themeId: theme.id, action: "restore" }), /Someone else updated/);
  await assert.rejects(api.managePortalTheme(renamed.revision, "admin", { themeId: "current", action: "restore" }), /Only the live theme/);
  await assert.rejects(api.managePortalTheme(renamed.revision, "admin", { themeId: theme.id, action: "rename", name: " " }));
  const restored = await api.managePortalTheme(renamed.revision, "admin", { themeId: theme.id, action: "restore" });
  assert.equal(restored.themes!.find(item => item.id === theme.id)?.design.heading, theme.design.heading);
  assert.equal(restored.draft.heading, theme.design.heading);
  assert.equal(restored.publishedAt, live.publishedAt);
  assert.equal(themeTools.portalThemeHasChanges(restored, theme.id), false);
});

test("removing drafts cannot remove the live or last theme and simultaneous library changes cannot overwrite each other", async () => {
  const { api } = dataModule();
  await assert.rejects(api.managePortalTheme(0, "admin", { themeId: "current", action: "remove" }), /at least one/);
  const added = await api.addPortalTheme(0, "admin", { templateId: "forma" });
  const theme = added.saved.themes!.find(item => item.id === added.themeId)!;
  const live = await api.savePortalDesign(theme.design, added.saved.revision, true, "admin", theme.id);
  await assert.rejects(api.managePortalTheme(live.revision, "admin", { themeId: theme.id, action: "remove" }), /live theme/);
  const results = await Promise.allSettled([
    api.managePortalTheme(live.revision, "admin", { themeId: "current", action: "rename", name: "Renamed draft" }),
    api.managePortalTheme(live.revision, "admin", { themeId: "current", action: "remove" }),
  ]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  const current = await api.getPortalDesign();
  const removed = await api.managePortalTheme(current.revision, "admin", { themeId: "current", action: "remove" });
  assert.equal(removed.themes!.length, 1);
  assert.equal(removed.liveThemeId, theme.id);
  assert.equal(removed.published?.theme, theme.design.theme);
  await assert.rejects(api.managePortalTheme(removed.revision, "admin", { themeId: "missing", action: "remove" }), /no longer/);
});

test("removing the most recently saved draft also removes its legacy draft content", async () => {
  const { api } = dataModule();
  const added = await api.addPortalTheme(0, "admin", { templateId: "bloom" });
  const design = added.saved.themes!.find(item => item.id === added.themeId)!.design;
  const edited = await api.savePortalDesign({ ...design, heading: "Removed draft content" }, added.saved.revision, false, "admin", added.themeId);
  const removed = await api.managePortalTheme(edited.revision, "admin", { themeId: added.themeId, action: "remove" });
  assert.equal(JSON.stringify(removed).includes("Removed draft content"), false);
  assert.equal(removed.published, null);
});

test("a new workspace uses its own brand in the default theme and in added templates", async () => {
  const { api } = dataModule();
  assert.equal((await api.getPortalDesign("Another business")).draft.brandName, "Another business");
  const added = await api.addPortalTheme(0, "admin", { templateId: "studio" }, "Another business");
  assert.equal(added.saved.themes!.find(item => item.id === added.themeId)?.design.brandName, "Another business");
  assert.equal(added.saved.themes!.find(item => item.id === "current")?.design.brandName, "Another business");
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
  const edited = { ...studio.design, heading: "An unpublished change" };
  const saved = await api.savePortalDesign(edited, live.revision, false, "admin", studio.id, "Studio live");
  assert.notEqual(saved.published?.heading, "An unpublished change");
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

test("website page edits persist with the selected theme and only reach the published site after publishing", async () => {
  const { api } = dataModule();
  const added = await api.addPortalTheme(0, "admin", { templateId: "studio" });
  const theme = added.saved.themes!.find(item => item.id === added.themeId)!;
  const website = portalWebsiteDesign(theme.design);
  website.pages[0].sections[0].title = "Our business homepage";
  const draft = await api.savePortalDesign({ ...theme.design, website }, added.saved.revision, false, "admin", theme.id);
  assert.equal(draft.themes!.find(item => item.id === theme.id)?.design.website?.pages[0].sections[0].title, "Our business homepage");
  assert.equal((await api.getPublishedPortalDesign()).website, undefined);
  const live = await api.savePortalDesign({ ...theme.design, website }, draft.revision, true, "admin", theme.id);
  assert.equal((await api.getPublishedPortalDesign()).website?.pages[0].sections[0].title, "Our business homepage");
  const nextWebsite = structuredClone(website);
  nextWebsite.pages[0].sections[0].title = "Unpublished homepage";
  await api.savePortalDesign({ ...theme.design, website: nextWebsite }, live.revision, false, "admin", theme.id);
  assert.equal((await api.getPublishedPortalDesign()).website?.pages[0].sections[0].title, "Our business homepage");
});

test("nested element settings survive saving and publication while later drafts stay private", async () => {
  const { api } = dataModule();
  const added = await api.addPortalTheme(0, "admin", { templateId: "studio" });
  const theme = added.saved.themes!.find(item => item.id === added.themeId)!;
  const website = portalWebsiteDesign(theme.design);
  website.pages[0].sections[0].blocks = websiteSectionBlocks(website.pages[0].sections[0], { brandName: theme.design.brandName, supportEmail: "", pages: website.pages, pageId: "home" });
  website.pages[0].sections[0].blocks.push({ ...createWebsiteBlock("group", "group"), style: { columns: 2, padding: 20 }, children: [{ ...createWebsiteBlock("heading", "child"), text: "Published nested heading", style: { fontSize: 42, color: "#123456" } }] });
  const live = await api.savePortalDesign({ ...theme.design, website }, added.saved.revision, true, "admin", theme.id);
  const stored = await api.getPublishedPortalDesign();
  assert.equal(stored.website?.pages[0].sections[0].blocks?.at(-1)?.children?.[0].text, "Published nested heading");
  assert.equal(stored.website?.pages[0].sections[0].blocks?.at(-1)?.children?.[0].style?.fontSize, 42);
  const next = structuredClone(website);
  next.pages[0].sections[0].blocks!.at(-1)!.children![0].text = "Unpublished nested heading";
  await api.savePortalDesign({ ...theme.design, website: next }, live.revision, false, "admin", theme.id);
  assert.equal((await api.getPublishedPortalDesign()).website?.pages[0].sections[0].blocks?.at(-1)?.children?.[0].text, "Published nested heading");
});
