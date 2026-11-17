import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { defaultPortalDesign, portalDesignSchema, type PortalDesign, type PortalDesignView } from "../portal-design";
import { createPortalTemplate, portalLibraryThemes, portalThemeListSchema, livePortalThemeId, portalTemplates } from "../portal-themes";

const fields = "draft,published,revision,updated_at,published_at,themes,live_theme_id";
type SavedRow = { draft: unknown; published: unknown; revision: number; updated_at: string; published_at: string | null; themes: unknown; live_theme_id: string | null };
function viewOf(data: SavedRow | null): PortalDesignView {
  return {
    draft: data ? portalDesignSchema.parse(data.draft) : defaultPortalDesign(),
    published: data?.published ? portalDesignSchema.parse(data.published) : null,
    revision: data?.revision ?? 0, updatedAt: data?.updated_at ?? null, publishedAt: data?.published_at ?? null,
    themes: data?.themes ? portalThemeListSchema.parse(data.themes) : [], liveThemeId: data?.live_theme_id ?? null,
  };
}
export async function getPortalDesign(): Promise<PortalDesignView> {
  const { data, error } = await createSupabaseAdmin().from("workspace_portal_designs").select(fields).eq("singleton", true).maybeSingle();
  if (error) throw new Error("Unable to load your theme library. Check that the portal theme library migration is installed.");
  return viewOf(data);
}
export async function getPublishedPortalDesign() {
  const { data, error } = await createSupabaseAdmin().from("workspace_portal_designs").select("published").eq("singleton", true).maybeSingle();
  if (error) throw new Error("Unable to verify the published customer portal.");
  return data?.published ? portalDesignSchema.parse(data.published) : defaultPortalDesign();
}
async function persistPortal(view: PortalDesignView, revision: number, userId: string) {
  const db = createSupabaseAdmin();
  const row = { draft: portalDesignSchema.parse(view.draft), published: view.published, revision: revision + 1, updated_at: new Date().toISOString(), updated_by: userId,
    themes: portalThemeListSchema.parse(view.themes), live_theme_id: view.liveThemeId ?? null, published_at: view.publishedAt };
  const query = revision === 0
    ? db.from("workspace_portal_designs").insert({ singleton: true, ...row })
    : db.from("workspace_portal_designs").update(row).eq("singleton", true).eq("revision", revision);
  const { data, error } = await query.select(fields).maybeSingle();
  if (error?.code === "23505" || (!error && !data)) throw new Error("Someone else updated this theme library. Reload before saving again.");
  if (error || !data) throw new Error("Unable to save this theme. Your changes have not been applied.");
  return viewOf(data);
}
export async function savePortalDesign(design: PortalDesign, revision: number, publish: boolean, userId: string, themeId = "current", themeName?: string): Promise<PortalDesignView> {
  const view = await getPortalDesign();
  if (view.revision !== revision) throw new Error("Someone else updated this theme library. Reload before saving again.");
  const themes = portalLibraryThemes(view);
  const selected = themes.find(theme => theme.id === themeId);
  if (!selected) throw new Error("This theme is no longer in your library.");
  const parsed = portalDesignSchema.parse(design);
  const now = new Date().toISOString();
  const saved = await persistPortal({ ...view, draft: parsed, themes: themes.map(theme => theme.id === themeId ? { ...theme, name: themeName ?? theme.name, design: parsed, updatedAt: now } : theme),
    published: publish ? parsed : view.published, publishedAt: publish ? now : view.publishedAt, liveThemeId: publish ? themeId : livePortalThemeId(view) }, revision, userId);
  return { ...saved, draft: parsed };
}
export async function addPortalTheme(revision: number, userId: string, input: { templateId?: string; sourceId?: string }) {
  const view = await getPortalDesign();
  if (view.revision !== revision) throw new Error("Someone else updated this theme library. Reload before adding a theme.");
  const themes = portalLibraryThemes(view);
  if (themes.length >= 20) throw new Error("Your library supports up to 20 themes.");
  const source = input.sourceId ? themes.find(theme => theme.id === input.sourceId) : null;
  if (input.sourceId && !source) throw new Error("The original theme could not be found.");
  const template = portalTemplates.find(item => item.id === input.templateId);
  const design = source?.design ?? createPortalTemplate(input.templateId ?? "", view.draft.brandName);
  const id = crypto.randomUUID();
  const theme = { id, name: source ? `${source.name.slice(0, 70)} copy` : template!.name, design, updatedAt: new Date().toISOString() };
  const saved = await persistPortal({ ...view, themes: [...themes, theme], liveThemeId: livePortalThemeId(view) }, revision, userId);
  return { saved, themeId: id };
}
