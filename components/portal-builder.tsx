"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Check, FileText, Globe, House, LayoutTemplate, LoaderCircle, MessageCircle, Monitor, Package, Paintbrush, PanelRight, Plus, Save, ShieldCheck, Smartphone, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PortalEditorSelect } from "@/components/portal-editor-select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PortalExperience } from "@/components/portal-experience";
import { portalPreviewData } from "@/lib/portal-preview";
import { portalDesignSchema, type PortalDesign, type PortalDesignView, type PortalSection } from "@/lib/portal-design";
import { livePortalThemeId, portalLibraryThemes, portalPages } from "@/lib/portal-themes";
import { updatePortalDesign } from "@/app/customer-portal/actions";
import "@/app/invoices/invoices.css";
import "@/app/customer/customer.css";
import "./portal-builder.css";

const colors = ["#16776b", "#5261d8", "#8867ac", "#ab644d", "#333b49", "#2879a5"];
const pageIcons = { home: House, tracking: Package, invoice: FileText, messages: MessageCircle, content: LayoutTemplate };
export function PortalBuilder({ initial, canWrite, workspaceName, themeId = "current", themeName = "My customer portal" }: { initial: PortalDesignView; canWrite: boolean; workspaceName: string; themeId?: string; themeName?: string }) {
  const [saved, setSaved] = useState(initial);
  const [design, setDesign] = useState(initial.draft);
  const [name, setName] = useState(themeName);
  const [savedName, setSavedName] = useState(themeName);
  const [page, setPage] = useState("home");
  const [panel, setPanel] = useState("page");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [showInspector, setShowInspector] = useState(true);
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const dirty = JSON.stringify(design) !== JSON.stringify(saved.draft) || name !== savedName;
  const isLive = livePortalThemeId(saved) === themeId;
  const unpublished = !isLive || JSON.stringify(design) !== JSON.stringify(saved.published);
  const pages = portalPages(design, true);
  const selectedPage = pages.find(item => item.id === page) ?? pages[0];
  const selected = design.sections.find(item => item.id === selectedPage.sectionId);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update<K extends keyof PortalDesign>(key: K, value: PortalDesign[K]) { setDesign(current => ({ ...current, [key]: value })); setNotice(""); setError(""); }
  function updateSection(id: string, patch: Partial<PortalSection>) { setDesign(current => ({ ...current, sections: current.sections.map(section => section.id === id ? { ...section, ...patch } : section) })); setNotice(""); setError(""); }
  function move(index: number, offset: number) {
    const sections = [...design.sections];
    [sections[index], sections[index + offset]] = [sections[index + offset], sections[index]];
    update("sections", sections);
  }
  function addPage() {
    const section: PortalSection = { id: crypto.randomUUID(), type: "content", title: "New page", body: "", enabled: true };
    update("sections", [...design.sections, section]); setPage(`pages/${section.id}`); setPanel("page"); setShowInspector(true);
  }
  async function save(publish: boolean) {
    if (!canWrite || saving.current) return;
    const parsed = portalDesignSchema.safeParse(design);
    if (!parsed.success || !name.trim()) { setError(parsed.success ? "Give this theme a name." : parsed.error.issues[0]?.message || "Check your theme settings."); return; }
    saving.current = true; setBusy(publish ? "publish" : "draft"); setError(""); setNotice("");
    try {
      const result = await updatePortalDesign({ design: parsed.data, revision: saved.revision, publish, themeId, themeName: name.trim() });
      if (result.error) setError(result.error);
      else if (result.saved) { setSaved(result.saved); setDesign(result.saved.draft); const nextName = portalLibraryThemes(result.saved).find(item => item.id === themeId)?.name ?? name.trim(); setName(nextName); setSavedName(nextName); setNotice(publish ? "Theme published." : "Theme saved."); }
    } catch { setError("Unable to save your theme. Please try again."); }
    finally { saving.current = false; setBusy(null); }
  }
  const pageControls = <><nav className="pb-page-list" aria-label="Portal pages">{pages.map(item => {
    const index = design.sections.findIndex(section => section.id === item.sectionId);
    const Icon = pageIcons[item.type];
    return <div className={`pb-page-row ${item.id === selectedPage.id ? "is-selected" : ""}`} key={item.id}><button type="button" aria-current={item.id === selectedPage.id ? "page" : undefined} onClick={() => { setPage(item.id); setPanel("page"); }}><Icon /><span>{item.label}{!item.enabled && <small>Hidden</small>}</span></button>{item.id !== "home" && <div><button type="button" aria-label={`Move ${item.label} up`} disabled={!canWrite || Boolean(busy) || index <= 0 || design.sections[index - 1]?.type === "overview"} onClick={() => move(index, -1)}><ArrowUp /></button><button type="button" aria-label={`Move ${item.label} down`} disabled={!canWrite || Boolean(busy) || index === design.sections.length - 1} onClick={() => move(index, 1)}><ArrowDown /></button></div>}</div>;
  })}</nav><div className="pb-add-page-wrap"><Button variant="outline" className="pb-add-page" disabled={!canWrite || Boolean(busy) || design.sections.length >= 12} onClick={addPage}><Plus />Add page</Button></div></>;
  return <div className="portal-builder">
    <header className="pb-topbar"><div className="pb-theme-title"><Link href="/customer-portal" aria-label="Back to theme library" onClick={event => { if (dirty && !window.confirm("Leave the editor and discard unsaved changes?")) event.preventDefault(); }}><ArrowLeft /></Link><div><small>Portal editor</small><div><strong>{name}</strong><Badge variant="secondary">{isLive ? "Live" : "Draft"}</Badge></div></div></div>
      <div className="pb-page-picker"><PortalEditorSelect label="Select portal page" value={selectedPage.id} options={pages.map(item => ({ value: item.id, label: item.label + (!item.enabled ? " (hidden)" : "") }))} onChange={next => { setPage(next); setPanel("page"); }} /></div>
      <div className="pb-save-actions"><span className={dirty ? "is-dirty" : ""}>{dirty ? <span className="pb-unsaved-dot" /> : <Check />}{dirty ? "Unsaved changes" : "All changes saved"}</span><Button size="sm" variant="outline" disabled={!canWrite || Boolean(busy) || (!dirty && saved.revision > 0)} onClick={() => void save(false)}>{busy === "draft" ? <LoaderCircle className="animate-spin" /> : <Save />}Save</Button><Button size="sm" disabled={!canWrite || Boolean(busy) || (!unpublished && !dirty)} onClick={() => void save(true)}>{busy === "publish" ? <LoaderCircle className="animate-spin" /> : <Globe />}Publish</Button></div>
    </header>
    {(error || notice || !canWrite) && <div className={`pb-feedback ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{error || notice || "Preview access. A workspace admin can edit and publish themes."}{notice && <Check />}</div>}
    <div className="pb-workbench" data-inspector={showInspector}>
      <aside className="pb-structure pb-glass" aria-label="Portal structure">
        <div className="pb-structure-heading"><span className="pb-panel-icon"><LayoutTemplate /></span><div><h2>Pages & design</h2><p>Make it your own</p></div></div>
        <nav className="pb-design-nav" aria-label="Design settings"><button type="button" aria-pressed={showInspector && panel === "theme"} onClick={() => { setPanel("theme"); setShowInspector(true); }}><Paintbrush />Theme settings<ArrowUp /></button><button type="button" aria-pressed={showInspector && panel === "features"} onClick={() => { setPanel("features"); setShowInspector(true); }}><ShieldCheck />Customer permissions<ArrowUp /></button></nav>
        <div className="pb-pages-heading"><h2>Pages</h2><span>{pages.length}</span></div>
        {pageControls}
        <div className="pb-workspace"><span>{workspaceName.slice(0, 1).toUpperCase()}</span><div><strong>{workspaceName}</strong><small>Customer portal</small></div></div>
      </aside>
      {showInspector && <aside className="pb-editor pb-glass" aria-label="Theme editor settings"><div className="pb-inspector-heading"><div className="pb-inspector-title"><span>Inspector</span><button type="button" aria-label="Close editor settings" onClick={() => setShowInspector(false)}><X /></button></div><PortalEditorSelect label="Editor settings" value={panel} options={[{ value: "page", label: "Page content" }, { value: "theme", label: "Theme settings" }, { value: "pages", label: "Pages & navigation" }, { value: "features", label: "Customer permissions" }]} onChange={setPanel} /></div><div className="pb-panel"><div className="pb-section-intro"><h2>{panel === "page" ? selectedPage.label : panel === "theme" ? "Brand & appearance" : panel === "pages" ? "Pages & navigation" : "Customer access"}</h2><p>{panel === "page" ? "Give this page your own voice." : panel === "theme" ? "The details that make it yours." : panel === "pages" ? "Arrange your customer experience." : "Choose what your customers can do."}</p></div>{panel === "pages" && pageControls}<fieldset disabled={!canWrite || Boolean(busy)}>
        {panel === "page" && <>
          
          {selected && <div className="pb-feature"><div><Label htmlFor="pb-page-visible">{selectedPage.type === "home" ? "Show payment overview" : "Visible to customers"}</Label></div><Switch id="pb-page-visible" checked={selected.enabled} onCheckedChange={enabled => updateSection(selected.id, { enabled })} /></div>}
          {selectedPage.type === "home" ? <><Label className="pb-field">Home heading (optional)<Input value={design.heading} maxLength={120} onChange={event => update("heading", event.target.value)} /></Label><Label className="pb-field">Home text (optional)<Textarea value={design.welcome} maxLength={300} rows={4} onChange={event => update("welcome", event.target.value)} /></Label></> : selected && <><Label className="pb-field">Page title<Input value={selected.title} maxLength={80} onChange={event => updateSection(selected.id, { title: event.target.value })} /></Label><Label className="pb-field">{selected.type === "content" ? "Page content" : "Page description"}<Textarea value={selected.body} maxLength={2000} rows={selected.type === "content" ? 9 : 4} onChange={event => updateSection(selected.id, { body: event.target.value })} /></Label></>}
          {selected?.type === "content" && <Button variant="destructive" size="sm" className="pb-remove-page" onClick={() => { update("sections", design.sections.filter(section => section.id !== selected.id)); setPage("home"); }}><Trash2 />Remove this page</Button>}
        </>}
        {panel === "theme" && <>
          <Label className="pb-field">Theme name<Input aria-label="Theme name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /></Label><Label className="pb-field">Brand name<Input value={design.brandName} maxLength={80} onChange={event => update("brandName", event.target.value)} /></Label><Label className="pb-field">Logo URL<Input type="url" value={design.logoUrl} placeholder="https://yourbrand.com/logo.png" maxLength={2000} onChange={event => update("logoUrl", event.target.value)} /></Label>
          <div className="pb-field"><span>Brand color</span><div className="pb-colors">{colors.map(color => <button type="button" key={color} aria-label={`Use ${color}`} aria-pressed={design.accent === color} style={{ background: color }} onClick={() => update("accent", color)} />)}<input type="color" aria-label="Custom brand color" value={/^#[0-9a-f]{6}$/i.test(design.accent) ? design.accent : "#16776b"} onChange={event => update("accent", event.target.value)} /></div><Input aria-label="Brand color hex code" value={design.accent} maxLength={7} onChange={event => update("accent", event.target.value)} /></div>
          <Label className="pb-field">Visual style<PortalEditorSelect label="Visual style" value={design.theme} options={[{ value: "minimal", label: "Minimal" }, { value: "soft", label: "Soft" }, { value: "bold", label: "Bold" }]} onChange={next => update("theme", next as PortalDesign["theme"])} /></Label><Label className="pb-field">Announcement<Textarea value={design.announcement} maxLength={300} placeholder="" onChange={event => update("announcement", event.target.value)} /></Label><Label className="pb-field">Footer<Input value={design.footer} maxLength={200} onChange={event => update("footer", event.target.value)} /></Label><Label className="pb-field">Support email<Input type="email" value={design.supportEmail} maxLength={254} placeholder="support@yourbrand.com" onChange={event => update("supportEmail", event.target.value)} /></Label>
        </>}
        {panel === "features" && <>{([
          ["downloadInvoice", "Download invoices", "Requires a visible Invoices page."],
          ["sendMessages", "Send messages", "Turn off for read-only messages."],
          ["languageSwitcher", "Choose a language", ""],
        ] as const).map(([key, label, description]) => <div className="pb-feature" key={key}><div><Label htmlFor={`pb-feature-${key}`}>{label}</Label><p>{description}</p></div><Switch id={`pb-feature-${key}`} checked={design.features[key]} onCheckedChange={enabled => update("features", { ...design.features, [key]: enabled })} /></div>)}<Link href="/companies" className="pb-text-link">Go to companies<ArrowUp /></Link></>}
      </fieldset></div><div className="pb-editor-footer"><span><span className="pb-preview-dot" />Live preview</span><Button size="sm" variant="ghost" disabled={!canWrite || Boolean(busy) || !dirty} onClick={() => { setDesign(saved.draft); setName(savedName); setPage("home"); setNotice(""); setError(""); }}><Undo2 />Discard edits</Button></div></aside>}
      <section className="pb-preview" aria-label="Portal preview"><div className="pb-preview-heading"><span><span className="pb-preview-dot" />Live preview</span><span>{selectedPage.label}</span></div><div className={`pb-browser pb-device-${device}`}><div className="pb-portal-frame"><PortalExperience data={portalPreviewData(design)} preview page={selectedPage.id} onPageChange={next => { setPage(next); setPanel("page"); }} /></div></div>
        <div className="pb-canvas-toolbar pb-glass"><div className="pb-device-toggle" role="group" aria-label="Preview size"><Button type="button" variant="ghost" size="icon-sm" aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone /></Button></div><span className="pb-device-label">{device === "desktop" ? "Desktop" : "Mobile"}</span><span className="pb-toolbar-divider" /><Button type="button" variant="ghost" size="sm" className="pb-inspector-toggle" aria-expanded={showInspector} onClick={() => setShowInspector(value => !value)}><PanelRight />Editor settings</Button></div>
      </section>
    </div>
  </div>;
}
