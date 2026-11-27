"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Check, Copy, ExternalLink, Eye, Globe, LayoutTemplate, Link2, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortalThemeArtwork } from "@/components/portal-theme-artwork";
import { PortalLocalTime } from "@/components/portal-local-time";
import type { PortalDesign, PortalDesignView, PortalSavedTheme } from "@/lib/portal-design";
import { createPortalTemplate, livePortalThemeId, portalLibraryThemes, portalThemeHasChanges, portalTemplates } from "@/lib/portal-theme-model";
import type { PortalDomain } from "@/lib/portal-domains";
import { changePortalTheme, createPortalTheme, publishPortalTheme } from "@/app/customer-portal/actions";
import "@/app/invoices/invoices.css";
import "@/app/customer/customer.css";
import "./portal-theme-library.css";

type ThemeOperation = { action: "publish" | "rename" | "remove" | "restore"; theme: PortalSavedTheme };
type DomainSummary = { domain: PortalDomain | null; hostingReady: boolean; available: boolean };
const PublishedWebsite = dynamic(() => import("@/components/portal-website").then(module => module.PortalWebsite), {
  loading: () => <div className="ptl-live-loading" />,
});
const performanceMetrics = ["LCP P75", "INP P75", "Cumulative Layout Shift", "Sessions"];
const PortalThemePreview = dynamic(() => import("@/components/portal-theme-preview").then(module => module.PortalThemePreview), {
  loading: () => <p role="status">Opening preview…</p>,
});
const PortalLibraryDialog = dynamic(() => import("@/components/portal-library-dialog").then(module => module.PortalLibraryDialog), {
  loading: () => <p role="status">Loading…</p>,
});
const PortalThemeMenu = dynamic(() => import("@/components/portal-theme-menu").then(module => module.PortalThemeMenu), {
  loading: () => <Button variant="ghost" size="icon-sm" disabled aria-label="Loading theme actions"><LoaderCircle className="animate-spin" /></Button>,
});

export function PortalThemeLibrary({ initial, canWrite, workspaceName, domainSettings, publicWebsitePath }: { initial: PortalDesignView; canWrite: boolean; workspaceName: string; domainSettings?: DomainSummary; publicWebsitePath?: string }) {
  const router = useRouter();
  const [localView, setView] = useState(initial);
  const view = initial.revision > localView.revision ? initial : localView;
  const [busy, setBusy] = useState("");
  const locked = useRef(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ id: string; name: string; design: PortalDesign; templateId?: string } | null>(null);
  const [operation, setOperation] = useState<ThemeOperation | null>(null);
  const [themeName, setThemeName] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState("");
  const [menusLoaded, setMenusLoaded] = useState(false);
  const [menuThemeId, setMenuThemeId] = useState<string | null>(null);
  const themes = portalLibraryThemes(view);
  const liveId = livePortalThemeId(view);
  const liveTheme = themes.find(theme => theme.id === liveId);
  const draftThemes = themes.filter(theme => theme.id !== liveId);
  const filtered = draftThemes.filter(theme => theme.name.toLowerCase().includes(query.trim().toLowerCase()));
  const liveChanged = liveTheme ? portalThemeHasChanges(view, liveTheme.id) : false;
  const atLimit = themes.length >= 20;
  const domain = domainSettings?.domain;
  const connected = domain?.status === "connected";
  const websiteUrl = connected ? `https://${domain.hostname}` : publicWebsitePath;
  const lastSaved = liveTheme?.updatedAt ?? view.updatedAt ?? view.publishedAt;
  const editHref = (id: string) => `/customer-portal/themes/${encodeURIComponent(id)}`;
  const stale = /Someone else updated|no longer in your library/.test(error);

  function refreshLibrary() {
    setError(""); setOperation(null); setChoosing(false); setPreview(null);
    startRefresh(() => router.refresh());
  }
  const conflictRecovery = stale ? <Button type="button" size="sm" variant="outline" disabled={refreshing || Boolean(busy)} onClick={refreshLibrary}><RefreshCw />Refresh library</Button> : null;

  function showPreview(id: string, name: string, design: PortalDesign, templateId?: string) { setPreview({ id, name, design, templateId }); }
  async function copyWebsiteLink() {
    if (!publicWebsitePath) return;
    try { await navigator.clipboard.writeText(new URL(publicWebsitePath, window.location.origin).href); setNotice("Website link copied."); }
    catch { setError("Unable to copy the link. Open the live preview and copy its address."); }
  }
  function requestOperation(action: ThemeOperation["action"], theme: PortalSavedTheme) { setError(""); setNotice(""); setThemeName(theme.name); setOperation({ action, theme }); }
  async function add(input: { templateId?: string; sourceId?: string }) {
    if (!canWrite || locked.current || refreshing) return;
    locked.current = true; setBusy(input.templateId || input.sourceId || "new"); setError(""); setNotice("");
    try {
      const result = await createPortalTheme({ ...input, revision: view.revision });
      if ("error" in result) { setError(result.error); if (/Someone else updated/.test(result.error)) { setChoosing(false); setPreview(null); } }
      else {
        setView(result.saved); setQuery(""); setChoosing(false); setPreview(null);
        const added = portalLibraryThemes(result.saved).find(theme => theme.id === result.themeId);
        setNotice(`${added?.name ?? "Theme"} added as a draft.`);
      }
    } catch { setError("Unable to add your theme. Please try again."); }
    finally { locked.current = false; setBusy(""); }
  }
  async function submitOperation() {
    if (!canWrite || !operation || locked.current || refreshing) return;
    const { action, theme } = operation;
    const name = themeName.trim();
    if (action === "rename" && (!name || name.length > 80)) { setError(!name ? "Give this theme a name." : "Use 80 characters or fewer for the theme name."); return; }
    locked.current = true; setBusy(`${action}:${theme.id}`); setError(""); setNotice("");
    try {
      const result = action === "publish"
        ? await publishPortalTheme({ themeId: theme.id, revision: view.revision })
        : await changePortalTheme({ themeId: theme.id, revision: view.revision, action, ...(action === "rename" ? { name } : {}) });
      if (result.error) setError(result.error);
      else if (result.saved) {
        setView(result.saved); setOperation(null);
        setNotice(action === "publish" ? `${theme.name} is now published.` : action === "rename" ? "Theme renamed." : action === "restore" ? "Draft restored to the published version." : "Draft theme removed.");
      }
    } catch { setError("Unable to update this theme. Please try again."); }
    finally { locked.current = false; setBusy(""); }
  }
  function themeMenu(theme: PortalSavedTheme, live = false) {
    if (!menusLoaded) return <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${theme.name}`} disabled={Boolean(busy)} onPointerEnter={() => void import("@/components/portal-theme-menu")} onFocus={() => void import("@/components/portal-theme-menu")} onClick={() => { setMenusLoaded(true); setMenuThemeId(theme.id); }}><MoreHorizontal /></Button>;
    return <PortalThemeMenu name={theme.name} open={menuThemeId === theme.id} onOpenChange={open => setMenuThemeId(open ? theme.id : null)} disabled={Boolean(busy)} canWrite={canWrite} atLimit={atLimit} live={live} changed={liveChanged} lastTheme={themes.length <= 1}
      onPreview={() => showPreview(theme.id, theme.name, theme.design)} onRename={() => requestOperation("rename", theme)} onDuplicate={() => void add({ sourceId: theme.id })} onRestore={() => requestOperation("restore", theme)} onRemove={() => requestOperation("remove", theme)} />;
  }
  const operationTitle = operation ? operation.action === "publish" ? `Publish ${operation.theme.name}?` : operation.action === "rename" ? "Rename theme" : operation.action === "restore" ? "Restore the published version?" : `Remove ${operation.theme.name}?` : "Theme settings";

  return <div className="portal-theme-library" aria-busy={Boolean(busy) || refreshing}>
    <header className="ptl-page-header"><h1>Website</h1>
      <div className="ptl-header-actions"><Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link href="/customer-portal/domains" />} aria-label="Domain settings" title="Domain settings"><Globe /></Button>{view.published && websiteUrl && <Button variant="outline" size="sm" nativeButton={false} render={<a href={websiteUrl} target="_blank" rel="noopener noreferrer" />}><ExternalLink />{connected ? "View website" : "Live preview"}</Button>}{view.published && publicWebsitePath && <Button variant="ghost" size="icon-sm" aria-label="Copy public website link" title="Copy public website link" onClick={() => void copyWebsiteLink()}><Link2 /></Button>}{canWrite && <Button size="sm" onClick={() => { setError(""); setChoosing(true); }} disabled={Boolean(busy) || atLimit}><Plus />Add theme</Button>}</div>
    </header>
    {!canWrite && <div className="ptl-notice" role="status"><ShieldCheck />You have preview access. A workspace admin can edit and publish themes.</div>}
    {error && !operation && !choosing && !preview && <div className="ptl-feedback is-error" role="alert"><span>{error}</span><Button size="sm" variant="outline" disabled={refreshing || Boolean(busy)} onClick={refreshLibrary}><RefreshCw />{refreshing ? "Refreshing…" : "Refresh library"}</Button></div>}
    {notice && <div className="ptl-feedback" role="status"><Check /><span>{notice}</span></div>}

    <section className="ptl-live-section" aria-labelledby="portal-published-heading">
      <h2 id="portal-published-heading" className="sr-only">Published theme</h2>
      <div className="ptl-performance" aria-label="Website performance, last 30 days">
        <div className="ptl-performance-period"><CalendarDays aria-hidden="true" /><span>30 days</span></div>
        <dl>{performanceMetrics.map(metric => <div key={metric} className="ptl-performance-metric"><dt>{metric}</dt><dd><span aria-label="No data available">&mdash;</span><span className="ptl-no-data">No data</span></dd></div>)}</dl>
      </div>
      {view.published ? <div className="ptl-live-card">
        <div className="ptl-live-art"><div className="ptl-live-site" aria-hidden="true" inert><PublishedWebsite design={view.published} preview /></div><button className="ptl-live-preview-hitbox" type="button" aria-label="Preview published theme" onClick={() => showPreview("published", liveTheme?.name ?? "Published theme", view.published!)} /></div>
        <div className="ptl-live-info"><div className="ptl-live-details"><h3 data-no-translate>{connected ? domain.hostname : view.published.brandName}</h3><p><span data-no-translate>{liveTheme?.name ?? "Published theme"}</span>{lastSaved && <><span className="ptl-meta-separator" aria-hidden="true">&middot;</span><span>Last saved: <PortalLocalTime value={lastSaved} /></span></>}{websiteUrl && <><span className="ptl-meta-separator" aria-hidden="true">&middot;</span><a href={websiteUrl} target="_blank" rel="noopener noreferrer">{connected ? "View website" : "Live preview"}<ExternalLink aria-hidden="true" /></a></>}</p>{liveChanged && <Badge variant="secondary">Unpublished changes</Badge>}</div>
          <div className="ptl-live-actions">{canWrite && liveTheme && <Button className="ptl-update-theme" size="sm" disabled={!liveChanged || Boolean(busy)} aria-label="Publish changes" title="Publish saved changes" onClick={() => requestOperation("publish", liveTheme)}>Update</Button>}<Button className="ptl-edit-theme" size="sm" disabled={!liveTheme || Boolean(busy)} nativeButton={false} render={<Link href={editHref(liveTheme?.id ?? "current")} />}>{canWrite ? "Edit theme" : "View theme"}</Button>{liveTheme && themeMenu(liveTheme, true)}</div>
        </div>
      </div> : <div className="ptl-unpublished"><div className="ptl-empty-icon"><Globe /></div><div><h3>No published theme</h3></div><Button size="sm" nativeButton={false} render={<Link href={editHref(themes[0].id)} />}><Pencil />{canWrite ? "Customize first theme" : "View first theme"}</Button></div>}
      {domainSettings?.available === false && <p className="ptl-domain-error" role="status">Unable to load domain settings.</p>}
    </section>

    <section className="ptl-library" aria-labelledby="portal-drafts-heading"><div className="ptl-section-title"><div><h2 id="portal-drafts-heading">Draft themes <Badge variant="secondary">{draftThemes.length}</Badge></h2></div>{draftThemes.length > 3 && <label className="ptl-search"><Search /><input className="ptl-input" aria-label="Search draft themes" placeholder="Search themes" value={query} onChange={event => setQuery(event.target.value)} /></label>}</div>
      {atLimit && <p className="ptl-limit" role="status">Your library has 20 themes. Remove a draft to add another.</p>}
      <div className="ptl-draft-grid">{filtered.map(theme => <article key={theme.id} className="ptl-draft-card">
        <button type="button" className="ptl-draft-thumb" aria-label={`Preview ${theme.name}`} onClick={() => showPreview(theme.id, theme.name, theme.design)}><PortalThemeArtwork design={theme.design} /><span className="ptl-preview-hint"><Eye />Preview theme</span></button>
        <div className="ptl-draft-info"><div className="ptl-draft-title"><h3 data-no-translate>{theme.name}</h3>{themeMenu(theme)}</div><div className="ptl-draft-meta"><Badge variant="secondary">Draft</Badge><span>{theme.updatedAt ? <>Saved <PortalLocalTime value={theme.updatedAt} /></> : "Ready to customize"}</span></div>
          <div className="ptl-draft-actions"><Button variant="outline" size="sm" nativeButton={false} render={<Link href={editHref(theme.id)} />}><Pencil />{canWrite ? "Customize" : "View theme"}</Button>{canWrite && <Button variant="ghost" size="sm" disabled={Boolean(busy)} aria-label={`Publish ${theme.name}`} onClick={() => requestOperation("publish", theme)}><Globe />Publish</Button>}</div>
        </div>
      </article>)}
      {!draftThemes.length && <div className="ptl-empty-drafts"><LayoutTemplate /><h3>No draft themes</h3>{canWrite && liveTheme && <Button size="sm" variant="outline" disabled={Boolean(busy) || atLimit} onClick={() => void add({ sourceId: liveTheme.id })}>{busy === liveTheme.id ? <LoaderCircle className="animate-spin" /> : <Copy />}Duplicate live theme</Button>}</div>}
      {draftThemes.length > 0 && !filtered.length && <div className="ptl-empty-drafts"><Search /><h3>No matching themes</h3><p>Try a different name or clear your search.</p><Button variant="outline" size="sm" onClick={() => setQuery("")}>Clear search</Button></div>}
      </div>
    </section>

    <section className="ptl-template-callout" aria-labelledby="portal-templates-heading"><div className="ptl-template-swatches" aria-hidden="true"><span /><span /><span /></div><div><h2 id="portal-templates-heading">Theme templates</h2></div><Button variant="outline" size="sm" onClick={() => { setError(""); setChoosing(true); }}><LayoutTemplate />Browse templates<ArrowRight /></Button></section>

    {choosing && <PortalLibraryDialog wide title="Choose a theme" description="Preview a theme or add it as a draft." onClose={() => { if (!busy) { setChoosing(false); setError(""); } }}>{error && <div className="ptl-dialog-error"><p role="alert">{error}</p>{conflictRecovery}</div>}{atLimit && <p className="ptl-limit">Your library is full. Remove a draft before adding another theme.</p>}
      <div className="ptl-template-grid">{portalTemplates.map(template => { const design = createPortalTemplate(template.id, view.revision === 0 ? workspaceName : view.draft.brandName); return <article key={template.id} className="ptl-template-card"><button type="button" className="ptl-template-preview" aria-label={`Preview ${template.name} template`} onClick={() => { setChoosing(false); showPreview(`template:${template.id}`, template.name, design, template.id); }}><PortalThemeArtwork design={design} /><span className="ptl-preview-hint"><Eye />Explore theme</span></button><div className="ptl-template-info"><div className="ptl-draft-title"><h3 data-no-translate>{template.name}</h3>{template.tag && <Badge variant="secondary">{template.tag}</Badge>}</div><p>{template.description}</p><div className="ptl-template-actions"><Button variant="ghost" size="sm" onClick={() => { setChoosing(false); showPreview(`template:${template.id}`, template.name, design, template.id); }}><Eye />Preview</Button>{canWrite && <Button size="sm" variant="outline" disabled={Boolean(busy) || atLimit} onClick={() => void add({ templateId: template.id })}>{busy === template.id ? <LoaderCircle className="animate-spin" /> : <Plus />}Add theme</Button>}</div></div></article>; })}</div>
    </PortalLibraryDialog>}

    {preview && <PortalThemePreview key={preview.id} name={preview.name} design={preview.design} onClose={() => { if (!busy) { setPreview(null); setError(""); if (preview.templateId) setChoosing(true); } }}>
      {error && <span className="ptl-dialog-error"><span role="alert">{error}</span>{conflictRecovery}</span>}{preview.templateId && canWrite && <Button size="sm" disabled={Boolean(busy) || atLimit} onClick={() => void add({ templateId: preview.templateId })}>{busy ? <LoaderCircle className="animate-spin" /> : <Plus />}Use this theme</Button>}{!preview.templateId && <Button size="sm" nativeButton={false} render={<Link href={editHref(preview.id === "published" ? liveId ?? "current" : preview.id)} />}><Pencil />{canWrite ? "Customize" : "View theme"}</Button>}
    </PortalThemePreview>}

    {operation && <PortalLibraryDialog title={operationTitle} onClose={() => { if (!busy) { setOperation(null); setError(""); } }} description={operation?.action === "publish" ? `${view.published ? "This replaces the published design for your website and customer account. Your other themes stay in the library." : "This publishes the theme to your website."} Orders, invoices, and messages stay unchanged.` : operation?.action === "rename" ? "Choose a name that helps your team recognize this theme." : operation?.action === "restore" ? "This replaces this theme’s saved draft changes with its current published design. Duplicate the draft first if you want to keep it." : "This permanently removes the draft from your library. Your published theme and customer data stay unchanged."}>
      <form onSubmit={event => { event.preventDefault(); void submitOperation(); }}>
        {operation?.action === "rename" && <label className="ptl-name-field">Theme name<input className="ptl-input" autoFocus value={themeName} maxLength={80} required onChange={event => setThemeName(event.target.value)} disabled={Boolean(busy)} /></label>}
        {error && <div className="ptl-dialog-error"><p role="alert">{error}</p>{conflictRecovery}</div>}
        <div className="ptl-dialog-actions"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => { setOperation(null); setError(""); }}>Cancel</Button><Button type="submit" variant={operation?.action === "remove" ? "destructive" : "default"} disabled={Boolean(busy)}>{busy && <LoaderCircle className="animate-spin" />}{operation?.action === "publish" ? "Publish theme" : operation?.action === "rename" ? "Save name" : operation?.action === "restore" ? "Restore draft" : "Remove draft"}</Button></div>
      </form>
    </PortalLibraryDialog>}
  </div>;
}
