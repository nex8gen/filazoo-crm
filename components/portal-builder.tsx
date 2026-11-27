"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, CirclePlus, Copy, Eye, EyeOff, Globe, GripVertical, ImageIcon, LayoutTemplate, LoaderCircle, Monitor, Paintbrush, Plus, Redo2, Save, Settings2, Smartphone, Trash2, Undo2, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { PortalEditorSelect } from "@/components/portal-editor-select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PortalExperience } from "@/components/portal-experience";
import { PortalWebsite } from "@/components/portal-website";
import { PortalElementTree } from "@/components/portal-element-tree";
import { PortalElementSettings } from "@/components/portal-element-settings";
import { PortalSectionAppearance } from "@/components/portal-section-appearance";
import { PortalSectionLibrary } from "@/components/portal-section-library";
import { EditorColor, EditorRange, EditorSettingsGroup, EditorToggle } from "@/components/portal-editor-fields";
import { portalPreviewData } from "@/lib/portal-preview";
import { portalDesignSchema, type PortalDesign, type PortalDesignView, type PortalSection, type PortalWebsiteBlock, type PortalWebsitePage, type PortalWebsiteSection } from "@/lib/portal-design";
import { livePortalThemeId, portalLibraryThemes, portalPages } from "@/lib/portal-themes";
import { createWebsiteSection, portalWebsiteDesign, portalWebsiteEditorPages, websiteSectionTypes } from "@/lib/portal-website-design";
import { blockCanContainChildren, changeWebsiteBlock, changeWebsiteSiblings, countWebsiteBlocks, createWebsiteBlock, duplicateWebsiteBlock, websiteBlockAt, websiteBlockPath, websiteBinding, websiteSectionBlocks } from "@/lib/portal-website-blocks";
import { updatePortalDesign } from "@/app/customer-portal/actions";
import "@/app/invoices/invoices.css";
import "@/app/customer/customer.css";
import "./portal-builder.css";

const colors = ["#16776b", "#5261d8", "#8867ac", "#ab644d", "#333b49", "#2879a5"];
export function PortalBuilder({ initial, canWrite, themeId = "current", themeName = "My website" }: { initial: PortalDesignView; canWrite: boolean; workspaceName: string; themeId?: string; themeName?: string }) {
  const [saved, setSaved] = useState(initial);
  const [design, setDesign] = useState(initial.draft);
  const [name, setName] = useState(themeName);
  const [savedName, setSavedName] = useState(themeName);
  const [page, setPage] = useState("website/home");
  const [panel, setPanel] = useState("section");
  const [block, setBlock] = useState("hero");
  const [elementPath, setElementPath] = useState<number[] | null>(null);
  const [elementParent, setElementParent] = useState<number[]>([]);
  const [expandedSections, setExpandedSections] = useState(() => new Set<string>());
  const [history, setHistory] = useState<{ past: { design: PortalDesign; name: string }[]; future: { design: PortalDesign; name: string }[] }>({ past: [], future: [] });
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"sections" | "preview" | "settings">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [showInspector, setShowInspector] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const saving = useRef(false);
  const dirty = JSON.stringify(design) !== JSON.stringify(saved.draft) || name !== savedName;
  const isLive = livePortalThemeId(saved) === themeId;
  const unpublished = !isLive || JSON.stringify(design) !== JSON.stringify(saved.published);
  const pages = portalPages(design, true);
  const website = portalWebsiteDesign(design);
  const websitePages = portalWebsiteEditorPages(design, true);
  const isWebsite = page.startsWith("website/");
  const websitePage = website.pages.find(item => item.id === websitePages.find(item => item.id === page)?.pageId) ?? website.pages[0];
  const selectedPage = isWebsite ? { id: page, label: websitePage.title, type: "content" as const, sectionId: undefined } : pages.find(item => item.id === page) ?? pages[0];
  const selected = design.sections.find(item => item.id === selectedPage.sectionId);
  const selectedWebsiteSection = websitePage.sections.find(item => item.id === block);
  const elementContext = { brandName: design.brandName, supportEmail: design.supportEmail, pages: website.pages, pageId: websitePage.id };
  const currentElements = selectedWebsiteSection ? websiteSectionBlocks(selectedWebsiteSection, elementContext) : [];
  const sectionHeading = websiteBinding(currentElements, "title");
  const sectionBody = websiteBinding(currentElements, "body");
  const sectionButton = websiteBinding(currentElements, "button");
  const selectedElement = elementPath ? websiteBlockAt(currentElements, elementPath) : undefined;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function remember() { setHistory(current => ({ past: [...current.past.slice(-49), { design, name }], future: [] })); }
  function update<K extends keyof PortalDesign>(key: K, value: PortalDesign[K]) { if (!canWrite || busy || JSON.stringify(value) === JSON.stringify(design[key])) return; remember(); setDesign({ ...design, [key]: value }); setNotice(""); setError(""); }
  function updateName(next: string) { if (!canWrite || busy || next === name) return; remember(); setName(next); setNotice(""); setError(""); }
  function undo(redo = false) {
    if (!canWrite || busy) return;
    const source = redo ? history.future : history.past;
    const next = source.at(-1); if (!next) return;
    setHistory(redo ? { past: [...history.past, { design, name }], future: history.future.slice(0, -1) } : { past: history.past.slice(0, -1), future: [...history.future, { design, name }] });
    setDesign(next.design); setName(next.name); setElementPath(null); setNotice(""); setError("");
    const nextSite = portalWebsiteDesign(next.design);
    const nextPage = nextSite.pages.find(item => item.id === websitePage.id);
    if (isWebsite && !nextPage) { setPage("website/home"); setPanel("page"); }
    else if (panel === "element" || (isWebsite && !nextPage?.sections.some(item => item.id === block))) setPanel("page");
  }
  function updateSection(id: string, patch: Partial<PortalSection>) { update("sections", design.sections.map(section => section.id === id ? { ...section, ...patch } : section)); }
  function updateWebsitePage(patch: Partial<PortalWebsitePage>) {
    update("website", { ...website, pages: website.pages.map(item => item.id === websitePage.id ? { ...item, ...patch } : item) });
  }
  function updateWebsiteSection(patch: Partial<PortalWebsiteSection>) {
    updateWebsitePage({ sections: websitePage.sections.map(item => {
      if (item.id !== block) return item;
      let blocks = patch.blocks ?? item.blocks;
      if (blocks && patch.blocks === undefined) {
        const sync = (items: PortalWebsiteBlock[]): PortalWebsiteBlock[] => items.map(element => ({ ...element,
          ...(element.binding === "title" && patch.title !== undefined ? { text: patch.title } : {}),
          ...(element.binding === "body" && patch.body !== undefined ? { text: patch.body } : {}),
          ...(element.binding === "image" && patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl } : {}),
          ...(element.binding === "button" ? { ...(patch.buttonLabel !== undefined ? { text: patch.buttonLabel } : {}), ...(patch.buttonPage !== undefined ? { link: patch.buttonPage } : {}) } : {}),
          ...(element.children ? { children: sync(element.children) } : {}),
        }));
        blocks = sync(blocks);
      }
      return { ...item, ...patch, ...(blocks ? { blocks } : {}) };
    }) });
  }
  function updateWebsite(patch: Partial<NonNullable<PortalDesign["website"]>>) { update("website", { ...website, ...patch }); }
  function changeElements(sectionId: string, change: (elements: PortalWebsiteBlock[]) => PortalWebsiteBlock[], selectId?: string) {
    if (!canWrite || busy) return;
    const section = websitePage.sections.find(item => item.id === sectionId); if (!section) return;
    const elements = change(section.blocks ?? websiteSectionBlocks(section, elementContext));
    if (elements.some(function tooManyChildren(item): boolean { return (item.children?.length ?? 0) > 24 || (item.children ?? []).some(tooManyChildren); })) { setError("A container supports up to 24 elements. Add another group for more content."); return; }
    if (countWebsiteBlocks(elements) > 60) { setError("A section supports up to 60 elements."); return; }
    updateWebsitePage({ sections: websitePage.sections.map(item => item.id === sectionId ? { ...item, blocks: elements } : item) });
    const id = selectId ?? (sectionId === block ? selectedElement?.id : undefined);
    if (id) {
      const path = websiteBlockPath(elements, id);
      if (path) { setBlock(sectionId); setElementPath(path); setPanel("element"); }
      else { setElementPath(null); setPanel("section"); }
    }
  }
  function selectElement(sectionId: string, path: number[]) {
    setBlock(sectionId); setElementPath(path); setPanel("element"); setShowInspector(true); setMobilePanel("settings");
    setExpandedSections(current => new Set([...current, sectionId]));
  }
  function updateElement(patch: Partial<PortalWebsiteBlock>) {
    if (!selectedElement || !elementPath) return;
    const dynamicContent = ["eyebrow", "email", "page-title", "page-link"].includes(selectedElement.binding ?? "") && (patch.text !== undefined || patch.link !== undefined);
    const blocks = changeWebsiteBlock(selectedWebsiteSection?.blocks ?? currentElements, elementPath, element => ({ ...element, ...patch, ...(dynamicContent ? { contentOverride: true, text: patch.text ?? selectedElement.text, link: patch.link ?? selectedElement.link } : {}) }));
    updateWebsiteSection({ blocks,
      ...(selectedElement.binding === "title" && patch.text !== undefined ? { title: patch.text.slice(0, 120) } : {}),
      ...(selectedElement.binding === "body" && patch.text !== undefined ? { body: patch.text } : {}),
      ...(selectedElement.binding === "image" && patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl } : {}),
      ...(selectedElement.binding === "button" && patch.text !== undefined ? { buttonLabel: patch.text.slice(0, 60) } : {}),
      ...(selectedElement.binding === "button" && patch.link !== undefined && /^(home|account|pages\/)/.test(patch.link) ? { buttonPage: patch.link } : {}),
    });
  }
  function openElements(sectionId: string, parent: number[] = []) {
    setBlock(sectionId); setElementParent(parent); setElementPath(null); openSettings("elements");
    setExpandedSections(current => new Set([...current, sectionId]));
  }
  function addElement(type: PortalWebsiteBlock["type"]) {
    if (!selectedWebsiteSection || elementParent.length >= 3) return;
    const parent = elementParent.length ? websiteBlockAt(currentElements, elementParent) : undefined;
    if (elementParent.length && (!parent || !blockCanContainChildren(parent))) return;
    const element = createWebsiteBlock(type, crypto.randomUUID());
    changeElements(block, elements => changeWebsiteSiblings(elements, elementParent, siblings => [...siblings, element]), element.id);
  }
  function duplicateElement(sectionId: string, path: number[]) {
    const section = websitePage.sections.find(item => item.id === sectionId); if (!section) return;
    const source = websiteBlockAt(websiteSectionBlocks(section, elementContext), path); if (!source) return;
    const copy = duplicateWebsiteBlock(source);
    if (source.type === "heading" && section.type === "hero" && source.binding === "title") copy.headingLevel = source.headingLevel ?? "h1";
    changeElements(sectionId, elements => changeWebsiteSiblings(elements, path.slice(0, -1), siblings => [...siblings.slice(0, path.at(-1)! + 1), copy, ...siblings.slice(path.at(-1)! + 1)]), copy.id);
  }
  function moveElement(sectionId: string, path: number[], target: number) {
    changeElements(sectionId, elements => changeWebsiteSiblings(elements, path.slice(0, -1), siblings => {
      const source = path.at(-1)!; if (!siblings[source] || target < 0 || target >= siblings.length) return siblings;
      const next = [...siblings]; const [item] = next.splice(source, 1); next.splice(target, 0, item); return next;
    }));
  }
  function selectPage(next: string) {
    setPage(next); setPanel("page"); setBlock(""); setElementPath(null); setShowInspector(true); setMobilePanel("preview"); setSectionPickerOpen(false);
  }
  function selectBlock(id: string) { setBlock(id); setElementPath(null); setPanel("section"); setShowInspector(true); setMobilePanel("settings"); setExpandedSections(current => new Set([...current, id, id.split("/")[0]])); }
  function toggleSection(id: string) { setExpandedSections(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function openSettings(next: string) { setPanel(next); setShowInspector(true); setMobilePanel("settings"); }
  function addPage(area: "website" | "account") {
    if (!canWrite || busy) return;
    const id = crypto.randomUUID();
    if (area === "website") {
      if (website.pages.length >= 12) return;
      update("website", { ...website, pages: [...website.pages, { id, title: "New page", enabled: true, sections: [createWebsiteSection("text", `text-${id}`)] }] });
      selectPage(`website/pages/${id}`);
    } else {
      if (design.sections.length >= 12) return;
      const section: PortalSection = { id, type: "content", title: "New page", body: "", enabled: true };
      update("sections", [...design.sections, section]); selectPage(`pages/${id}`);
    }
  }
  function addSection(type: PortalWebsiteSection["type"]) {
    if (!canWrite || busy || websitePage.sections.length >= 20) return;
    const section = createWebsiteSection(type, crypto.randomUUID());
    updateWebsitePage({ sections: [...websitePage.sections, section] }); selectBlock(section.id); setSectionPickerOpen(false);
  }
  function duplicateSection(id: string) {
    if (!canWrite || busy || websitePage.sections.length >= 20) return;
    const section = websitePage.sections.find(item => item.id === id); if (!section) return;
    const copy = { ...section, id: crypto.randomUUID(), name: `${(section.name || section.title || section.type).slice(0, 115)} copy`, blocks: websiteSectionBlocks(section, elementContext).map(element => duplicateWebsiteBlock(element, true)) };
    const index = websitePage.sections.indexOf(section);
    updateWebsitePage({ sections: [...websitePage.sections.slice(0, index + 1), copy, ...websitePage.sections.slice(index + 1)] }); selectBlock(copy.id);
  }
  function removeSection(id: string) {
    if (!canWrite || busy || !websitePage.sections.some(item => item.id === id)) return;
    updateWebsitePage({ sections: websitePage.sections.filter(item => item.id !== id) });
    if (block === id) { setBlock(""); setElementPath(null); setPanel("page"); }
    setExpandedSections(current => { const next = new Set(current); next.delete(id); return next; });
  }
  function moveWebsiteSection(index: number, offset: number) {
    const sections = [...websitePage.sections];
    if (!canWrite || busy || !sections[index] || index + offset < 0 || index + offset >= sections.length) return;
    const [section] = sections.splice(index, 1); sections.splice(index + offset, 0, section);
    updateWebsitePage({ sections });
  }
  async function save(publish: boolean, confirmed = false) {
    if (!canWrite || saving.current) return;
    const parsed = portalDesignSchema.safeParse(design);
    if (!name.trim()) { openSettings("theme"); setError("Give this theme a name."); return; }
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const invalidPage = issue.path[0] === "website" && issue.path[1] === "pages" && typeof issue.path[2] === "number" ? website.pages[issue.path[2]] : undefined;
      const invalidSection = invalidPage && issue.path[3] === "sections" && typeof issue.path[4] === "number" ? invalidPage.sections[issue.path[4]] : undefined;
      const field = String([...issue.path].reverse().find(part => typeof part === "string") ?? "setting").replace(/([a-z])([A-Z])/g, "$1 $2");
      setError([invalidPage?.title, invalidSection?.name || invalidSection?.title, field].filter(Boolean).join(" / ") + ": " + issue.message);
      return;
    }
    if (publish && !confirmed) { setError(""); setConfirmPublish(true); return; }
    saving.current = true; setBusy(publish ? "publish" : "draft"); setError(""); setNotice("");
    try {
      const result = await updatePortalDesign({ design: parsed.data, revision: saved.revision, publish, themeId, themeName: name.trim() });
      if (result.error) setError(result.error);
      else if (result.saved) { setSaved(result.saved); setDesign(result.saved.draft); setHistory({ past: [], future: [] }); const nextName = portalLibraryThemes(result.saved).find(item => item.id === themeId)?.name ?? name.trim(); setName(nextName); setSavedName(nextName); setConfirmPublish(false); setNotice(publish ? "Theme published." : "Theme saved."); }
    } catch { setError("Unable to save your theme. Please try again."); }
    finally { saving.current = false; setBusy(null); }
  }
  const sectionRow = (id: string, label: string, hidden = false, type?: PortalWebsiteSection["type"]) => {
    const Icon = type === "video" ? Video : type && ["hero", "image", "gallery", "slideshow", "logos"].includes(type) ? ImageIcon : LayoutTemplate;
    const active = ["section", "elements"].includes(panel) && block === id;
    return <button type="button" className={`pb-section-button ${active ? "is-selected" : ""}`} aria-pressed={active} onClick={() => selectBlock(id)}><Icon className={type ? "pb-row-type-icon" : undefined} />{type && <GripVertical className="pb-row-drag-handle" aria-hidden="true" />}<span>{label}</span>{hidden && <EyeOff className="pb-hidden-indicator" aria-label="Hidden" />}</button>;
  };
  const globalSection = (id: string, label: string, hidden: boolean, children: ReactNode) => <div className="pb-section-item"><div className="pb-section-heading-row"><button type="button" className="pb-section-expander" aria-label={`${expandedSections.has(id) ? "Collapse" : "Expand"} ${label} elements`} aria-expanded={expandedSections.has(id)} onClick={() => toggleSection(id)}>{expandedSections.has(id) ? <ChevronDown /> : <ChevronRight />}</button>{sectionRow(id, label, hidden)}</div>{expandedSections.has(id) && <div className="pb-global-elements">{children}</div>}</div>;
  const pageDestinations = [...websitePages.filter(item => item.enabled).map(item => ({ value: item.pageId === "home" ? "home" : `pages/${item.pageId}`, label: item.label })), { value: "account", label: "Customer account" }];
  const navigation = website.navigation ?? website.pages.map(item => ({ id: item.id, label: item.id === "home" ? "Home" : item.title.slice(0, 60), link: item.id === "home" ? "home" : `pages/${item.id}`, enabled: item.enabled }));
  const inspectorTitle = panel === "element" ? selectedElement?.title || "Element settings" : panel === "elements" ? "Add element" : panel === "library" ? "Section library" : panel === "section" ? (selectedWebsiteSection?.name || selectedWebsiteSection?.title) || (block.startsWith("header") ? "Header" : block.startsWith("footer") ? "Footer" : block === "announcement" ? "Announcement bar" : selected?.title) || "Section settings" : "Settings";
  const sectionControls = <>
    <div className="pb-section-group"><h3>Header</h3>{isWebsite ? <><div className="pb-section-leaf">{sectionRow("announcement", "Announcement bar", !design.announcement)}</div>{globalSection("header", "Header", website.header?.enabled === false, <>{sectionRow("header/brand", "Logo & brand")}{sectionRow("header/navigation", "Navigation")}{sectionRow("header/account", "Customer account link")}</>)}</> : <div className="pb-section-leaf">{sectionRow("header", "Account header")}</div>}</div>
    <div className="pb-section-group"><h3>Template</h3>{isWebsite ? websitePage.sections.map((section, index) => {
      const expanded = expandedSections.has(section.id);
      const elements = websiteSectionBlocks(section, elementContext);
      return <div key={section.id} className="pb-section-item"><div className="pb-section-row" draggable={canWrite && !busy} onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-filazoo-section", JSON.stringify({ page: websitePage.id, section: section.id })); }} onDragOver={event => { if (canWrite && !busy && event.dataTransfer.types.includes("application/x-filazoo-section")) event.preventDefault(); }} onDrop={event => {
        if (!canWrite || busy) return;
        try { const source = JSON.parse(event.dataTransfer.getData("application/x-filazoo-section")); const from = websitePage.sections.findIndex(item => item.id === source.section); if (source.page === websitePage.id && from >= 0) { event.preventDefault(); moveWebsiteSection(from, index - from); } } catch {}
      }}>
      <div className="pb-section-heading-row"><button type="button" className="pb-section-expander" aria-label={`${expanded ? "Collapse" : "Expand"} ${section.name || section.title || section.type} elements`} aria-expanded={expanded} onClick={() => toggleSection(section.id)}>{expanded ? <ChevronDown /> : <ChevronRight />}</button>{sectionRow(section.id, section.name || section.title || websiteSectionTypes.find(item => item.value === section.type)!.label, !section.enabled, section.type)}</div>
      <div className="pb-section-actions"><button type="button" title="Delete section" aria-label={`Delete ${section.name || section.title || section.type} section`} disabled={!canWrite || Boolean(busy)} onClick={() => removeSection(section.id)}><Trash2 /></button><button type="button" title={section.enabled ? "Hide section" : "Show section"} aria-label={`${section.enabled ? "Hide" : "Show"} ${section.name || section.title || section.type}`} disabled={!canWrite || Boolean(busy)} onClick={() => updateWebsitePage({ sections: websitePage.sections.map(item => item.id === section.id ? { ...item, enabled: !item.enabled } : item) })}>{section.enabled ? <Eye /> : <EyeOff />}</button></div>
    </div>{expanded && <div className="pb-section-nested"><PortalElementTree blocks={elements} scope={`${websitePage.id}:${section.id}`} selected={block === section.id && elementPath && panel === "element" ? elementPath.join(".") : undefined} canWrite={canWrite && !busy} canAdd={countWebsiteBlocks(elements) < 60} onSelect={path => selectElement(section.id, path)} onToggle={path => changeElements(section.id, items => changeWebsiteBlock(items, path, item => ({ ...item, enabled: !item.enabled })))} onRemove={path => changeElements(section.id, items => changeWebsiteBlock(items, path, () => null))} onMove={(path, target) => moveElement(section.id, path, target)} onAdd={parent => openElements(section.id, parent)} /><Button type="button" variant="ghost" size="sm" className="pb-add-element" disabled={!canWrite || Boolean(busy) || countWebsiteBlocks(elements) >= 60} onClick={() => openElements(section.id)}><Plus />Add element</Button></div>}</div>;
    }) : <>{selected && sectionRow(selected.id, selectedPage.type === "home" ? "Payment overview" : selected.title, !selected.enabled)}{selectedPage.type === "home" && sectionRow("shortcuts", "Account navigation")}</>}
    {isWebsite && <div className="pb-add-section"><Popover open={sectionPickerOpen} onOpenChange={setSectionPickerOpen}><PopoverTrigger render={<Button variant="ghost" size="sm" disabled={!canWrite || Boolean(busy) || websitePage.sections.length >= 20} />}><CirclePlus />Add section</PopoverTrigger><PopoverContent className="pb-section-picker" side="right" align="start" sideOffset={12} aria-label="Add a section"><PortalSectionLibrary compact mode="section" disabled={!canWrite || Boolean(busy) || websitePage.sections.length >= 20} onAdd={type => addSection(type as PortalWebsiteSection["type"])} /></PopoverContent></Popover></div>}</div>
    <div className="pb-section-group"><h3>Footer</h3>{isWebsite ? globalSection("footer", "Footer", website.footer?.enabled === false, <>{sectionRow("footer/content", "Brand & text")}{sectionRow("footer/contact", "Contact information")}{sectionRow("footer/navigation", "Footer navigation")}</>) : <div className="pb-section-leaf">{sectionRow("footer", "Footer")}</div>}</div>
  </>;
  return <div className="portal-builder">
    <header className="pb-topbar"><div className="pb-theme-title"><Link href="/customer-portal" aria-label="Back to theme library" onClick={event => { if (dirty && !window.confirm("Leave the editor and discard unsaved changes?")) event.preventDefault(); }}><span className="pb-back-text" aria-hidden="true"><span className="pb-back-name">Themes</span><span className="pb-back-action">Back</span></span></Link><span aria-hidden="true">/</span><div><div><strong>{name}</strong><Badge variant="secondary">{isLive ? "Live" : "Draft"}</Badge></div></div><div className="pb-toolbar-tools" role="group" aria-label="Edit history"><Button variant="ghost" size="icon-sm" aria-label="Undo edit" disabled={!canWrite || Boolean(busy) || history.past.length === 0} onClick={() => undo()}><Undo2 /></Button><Button variant="ghost" size="icon-sm" aria-label="Redo edit" disabled={!canWrite || Boolean(busy) || history.future.length === 0} onClick={() => undo(true)}><Redo2 /></Button></div></div>
      <div className="pb-page-picker"><PortalEditorSelect label="Select portal page" value={selectedPage.id} options={[
        ...websitePages.map(item => ({ value: item.id, label: item.label + (!item.enabled ? " (hidden)" : ""), group: "B2B website" })),
        ...pages.map(item => ({ value: item.id, label: `Customer account · ${item.label}${!item.enabled ? " (hidden)" : ""}`, group: "Customer account" })),
      ]} onChange={selectPage} /></div>
      <div className="pb-save-actions"><div className="pb-toolbar-tools"><Button variant="ghost" size="icon-sm" aria-label="Theme settings" aria-pressed={showInspector && panel === "theme"} onClick={() => openSettings("theme")}><Paintbrush /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={interacting ? "Return to editing" : "Interact with preview"} aria-pressed={interacting} onClick={() => { setInteracting(value => !value); setMobilePanel("preview"); }}><Eye /></Button><div className="pb-device-toggle" role="group" aria-label="Preview size"><Button type="button" variant="ghost" size="icon-sm" aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => { setDevice("desktop"); setMobilePanel("preview"); }}><Monitor /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => { setDevice("mobile"); setMobilePanel("preview"); }}><Smartphone /></Button></div></div><div className="pb-toolbar-commands"><Button size="sm" variant="outline" disabled={!canWrite || Boolean(busy) || (!dirty && saved.revision > 0)} onClick={() => void save(false)}>{busy === "draft" ? <LoaderCircle className="animate-spin" /> : <Save />}Save</Button><Button size="sm" disabled={!canWrite || Boolean(busy) || (!unpublished && !dirty)} onClick={() => void save(true)}>{busy === "publish" ? <LoaderCircle className="animate-spin" /> : <Globe />}Publish</Button></div></div>
    </header>
    {(error || notice || !canWrite) && <div className={`pb-feedback ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{error || notice || "Preview access. A workspace admin can edit and publish themes."}{notice && <Check />}</div>}
    <Dialog open={confirmPublish} onOpenChange={open => { if (!busy) setConfirmPublish(open); }}><DialogContent><DialogHeader><DialogTitle>Publish {name.trim()}?</DialogTitle><DialogDescription>This saves your changes and makes this design visible on your website and customer account. Orders, invoices, and messages stay unchanged.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={Boolean(busy)} onClick={() => setConfirmPublish(false)}>Keep editing</Button><Button disabled={Boolean(busy)} onClick={() => void save(true, true)}>{busy === "publish" ? <LoaderCircle className="animate-spin" /> : <Globe />}Publish theme</Button></DialogFooter></DialogContent></Dialog>
    <div className="pb-mobile-tabs" role="group" aria-label="Website editor view"><Button variant={mobilePanel === "sections" ? "secondary" : "ghost"} aria-pressed={mobilePanel === "sections"} onClick={() => { setMobilePanel("sections"); }}><LayoutTemplate />Sections</Button><Button variant={mobilePanel === "preview" ? "secondary" : "ghost"} aria-pressed={mobilePanel === "preview"} onClick={() => setMobilePanel("preview")}><Monitor />Preview</Button><Button variant={mobilePanel === "settings" ? "secondary" : "ghost"} aria-pressed={mobilePanel === "settings"} onClick={() => { setShowInspector(true); setMobilePanel("settings"); }}><Settings2 />Settings</Button></div>
    <div className="pb-workbench" data-inspector={showInspector} data-mobile-panel={mobilePanel}>
      <aside className="pb-structure pb-glass" aria-label="Portal structure">
        <div className="pb-structure-heading"><h2>{selectedPage.label}</h2><Button variant="ghost" size="icon-sm" aria-label="Page settings" onClick={() => openSettings("page")}><Settings2 /></Button></div>
        <div className="pb-structure-scroll">{sectionControls}</div>
      </aside>
      {showInspector && <aside className="pb-editor pb-glass" aria-label="Theme editor settings"><div className="pb-inspector-heading"><div className="pb-inspector-title"><span className="pb-inspector-icon">{panel === "theme" ? <Paintbrush /> : <LayoutTemplate />}</span><h2>{inspectorTitle}</h2><button type="button" aria-label="Close editor settings" onClick={() => { setShowInspector(false); setMobilePanel("preview"); }}><X /></button></div><div className="pb-inspector-mode"><PortalEditorSelect label="Editor settings" value={panel} options={[{ value: "section", label: "Section settings" }, { value: "element", label: "Element settings" }, ...(isWebsite ? [{ value: "library", label: "Section library" }] : []), ...(isWebsite && selectedWebsiteSection ? [{ value: "elements", label: "Add element" }] : []), { value: "page", label: "Page settings" }, { value: "theme", label: "Theme settings" }, { value: "pages", label: "Pages & navigation" }, { value: "features", label: "Customer permissions" }]} onChange={setPanel} /></div></div><div className="pb-panel"><fieldset disabled={!canWrite || Boolean(busy)}>
        {panel === "library" && isWebsite && <PortalSectionLibrary mode="section" disabled={!canWrite || Boolean(busy) || websitePage.sections.length >= 20} onAdd={type => addSection(type as PortalWebsiteSection["type"])} />}
        {panel === "elements" && isWebsite && selectedWebsiteSection && <PortalSectionLibrary key={`${block}:${elementParent.join(".")}`} mode="element" depth={elementParent.length} disabled={!canWrite || Boolean(busy) || countWebsiteBlocks(currentElements) >= 60} onAdd={type => addElement(type as PortalWebsiteBlock["type"])} />}
        {panel === "element" && selectedElement && elementPath && <PortalElementSettings key={`${block}:${selectedElement.id}`} block={selectedElement} path={elementPath} canAdd={countWebsiteBlocks(currentElements) < 60} pages={pageDestinations} onChange={updateElement} onBack={() => selectBlock(block)} onDuplicate={() => duplicateElement(block, elementPath)} onRemove={() => changeElements(block, elements => changeWebsiteBlock(elements, elementPath, () => null))} onAddChild={type => {
          const element = createWebsiteBlock(type, crypto.randomUUID());
          if (elementPath.length >= 2 && element.children) { setError("Choose a content element at the deepest level."); return; }
          changeElements(block, elements => changeWebsiteSiblings(elements, elementPath, siblings => [...siblings, element]), element.id);
        }} />}
        {panel === "element" && !selectedElement && <p className="pb-help">Expand a section and select an element to edit it.</p>}
        {panel === "pages" && <><div className="pb-section-intro"><h2>Pages & navigation</h2><p>Switch between pages using the top dropdown.</p></div><h3 className="pb-setting-label">B2B website</h3>{websitePages.map(item => <Button key={item.id} variant="ghost" className="pb-manage-page" onClick={() => selectPage(item.id)}>{item.label}{!item.enabled && <EyeOff />}</Button>)}<Button variant="outline" size="sm" disabled={website.pages.length >= 12} onClick={() => addPage("website")}><Plus />Add website page</Button><h3 className="pb-setting-label">Customer account</h3>{pages.map(item => <Button key={item.id} variant="ghost" className="pb-manage-page" onClick={() => selectPage(item.id)}>{item.label}{!item.enabled && <EyeOff />}</Button>)}<Button variant="outline" size="sm" disabled={design.sections.length >= 12} onClick={() => addPage("account")}><Plus />Add account page</Button></>}
        {panel === "section" && isWebsite && selectedWebsiteSection && <>
          <div className="pb-feature"><Label htmlFor="pb-section-visible">Visible on page</Label><Switch id="pb-section-visible" checked={selectedWebsiteSection.enabled} onCheckedChange={enabled => updateWebsiteSection({ enabled })} /></div>
          <Label className="pb-field">Section name<Input aria-label="Section name" value={selectedWebsiteSection.name ?? ""} placeholder={selectedWebsiteSection.title || selectedWebsiteSection.type} maxLength={120} onChange={event => updateWebsiteSection({ name: event.target.value })} /><small>Shown in the editor only.</small></Label>
          {sectionHeading && <Label className="pb-field">Heading<Input aria-label="Section heading" value={sectionHeading.text} maxLength={120} onChange={event => updateWebsiteSection({ title: event.target.value })} /></Label>}
          {sectionBody && <Label className="pb-field">Text<Textarea aria-label="Section text" value={sectionBody.text} maxLength={4000} rows={5} onChange={event => updateWebsiteSection({ body: event.target.value })} /></Label>}
          {(["hero", "banner"].includes(selectedWebsiteSection.type) || websiteBinding(currentElements, "image")) && <Label className="pb-field">Image URL<Input aria-label="Section image URL" type="url" value={selectedWebsiteSection.imageUrl} maxLength={2000} placeholder="https://" onChange={event => updateWebsiteSection({ imageUrl: event.target.value })} /></Label>}
          {["hero", "image", "banner", "slideshow"].includes(selectedWebsiteSection.type) && <EditorRange label="Section height" min={160} max={900} step={10} value={selectedWebsiteSection.height} onChange={height => updateWebsiteSection({ height })} />}
          <Label className="pb-field">Alignment<PortalEditorSelect label="Section alignment" value={selectedWebsiteSection.alignment} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }]} onChange={next => updateWebsiteSection({ alignment: next as "left" | "center" })} /></Label>
          {sectionButton && <><Label className="pb-field">Button label<Input aria-label="Section button label" value={sectionButton.text} maxLength={60} onChange={event => updateWebsiteSection({ buttonLabel: event.target.value })} /></Label>
          <Label className="pb-field">Button destination<PortalEditorSelect label="Button destination" value={pageDestinations.some(item => item.value === sectionButton.link) ? sectionButton.link : "custom"} options={[{ value: "custom", label: "Custom link (edit the button element)" }, ...websitePages.filter(item => item.enabled).map(item => ({ value: item.pageId === "home" ? "home" : `pages/${item.pageId}`, label: item.label })), { value: "account", label: "Customer account" }]} onChange={buttonPage => { if (buttonPage !== "custom") updateWebsiteSection({ buttonPage }); }} /></Label></>}
          {selectedWebsiteSection.type === "contact" && <Label className="pb-field">Contact email<Input type="email" value={design.supportEmail} maxLength={254} onChange={event => update("supportEmail", event.target.value)} /></Label>}
          <div className="pb-element-actions"><Button variant="outline" size="sm" disabled={countWebsiteBlocks(currentElements) >= 60} onClick={() => openElements(block)}><Plus />Add element</Button><Button variant="outline" size="sm" disabled={websitePage.sections.length >= 20} onClick={() => duplicateSection(block)}><Copy />Duplicate section</Button></div>
          <PortalSectionAppearance section={selectedWebsiteSection} onChange={updateWebsiteSection} />
          <Button variant="destructive" size="sm" onClick={() => removeSection(block)}><Trash2 />Remove section</Button>
        </>}
        {panel === "section" && !selectedWebsiteSection && !selected && !["announcement", "header", "footer", "shortcuts"].includes(block.split("/")[0]) && <p className="pb-help">Choose a section on the left or add a section to start editing.</p>}
        {panel === "section" && block === "announcement" && <Label className="pb-field">Announcement text<Textarea value={design.announcement} maxLength={300} onChange={event => update("announcement", event.target.value)} /><small>Leave empty to hide the announcement bar.</small></Label>}
        {panel === "section" && (block === "header" || block.startsWith("header/")) && <><Label className="pb-field">Brand name<Input value={design.brandName} maxLength={80} onChange={event => update("brandName", event.target.value)} /></Label><Label className="pb-field">Logo URL<Input type="url" value={design.logoUrl} maxLength={2000} onChange={event => update("logoUrl", event.target.value)} /></Label>{isWebsite && <>
          <EditorSettingsGroup title="Header elements"><EditorToggle label="Show header" checked={website.header?.enabled ?? true} onChange={enabled => updateWebsite({ header: { ...website.header, enabled } })} /><EditorToggle label="Show brand name" checked={website.header?.showBrand ?? !design.logoUrl} onChange={showBrand => updateWebsite({ header: { ...website.header, showBrand } })} /><EditorToggle label="Show logo" checked={website.header?.showLogo ?? true} onChange={showLogo => updateWebsite({ header: { ...website.header, showLogo } })} /><EditorRange label="Logo width" min={40} max={240} value={website.header?.logoWidth ?? 150} onChange={logoWidth => updateWebsite({ header: { ...website.header, logoWidth } })} /><EditorToggle label="Sticky header" checked={website.header?.sticky ?? false} onChange={sticky => updateWebsite({ header: { ...website.header, sticky } })} /><EditorToggle label="Show navigation" checked={website.header?.showNavigation ?? true} onChange={showNavigation => updateWebsite({ header: { ...website.header, showNavigation } })} /><EditorToggle label="Show customer account link" checked={website.header?.showAccount ?? true} onChange={showAccount => updateWebsite({ header: { ...website.header, showAccount } })} /><Label className="pb-field">Customer account label<Input value={website.header?.accountLabel ?? "Customer account"} maxLength={60} onChange={event => updateWebsite({ header: { ...website.header, accountLabel: event.target.value } })} /></Label></EditorSettingsGroup>
          <EditorSettingsGroup title="Header appearance"><EditorColor label="Header background" value={website.header?.background ?? ""} fallback="#ffffff" onChange={background => updateWebsite({ header: { ...website.header, background } })} /><EditorColor label="Header text color" value={website.header?.color ?? ""} onChange={color => updateWebsite({ header: { ...website.header, color } })} /><EditorRange label="Header padding" min={8} max={64} value={website.header?.padding ?? 22} onChange={padding => updateWebsite({ header: { ...website.header, padding } })} /></EditorSettingsGroup>
          <EditorSettingsGroup title="Menu links">{navigation.map((item, index) => <div key={item.id} className="pb-menu-item"><Label className="pb-field">Link label<Input aria-label={`Menu link ${index + 1} label`} value={item.label} maxLength={60} onChange={event => updateWebsite({ navigation: navigation.map(link => link.id === item.id ? { ...link, label: event.target.value } : link) })} /></Label><Label className="pb-field">Destination<Input aria-label={`Menu link ${index + 1} destination`} value={item.link} maxLength={2000} onChange={event => updateWebsite({ navigation: navigation.map(link => link.id === item.id ? { ...link, link: event.target.value } : link) })} /></Label><div className="pb-element-actions"><Button variant="ghost" size="icon-sm" aria-label={`Move menu link ${index + 1} up`} disabled={index === 0} onClick={() => { const links = [...navigation]; [links[index - 1], links[index]] = [links[index], links[index - 1]]; updateWebsite({ navigation: links }); }}><ArrowUp /></Button><Button variant="ghost" size="icon-sm" aria-label={`Move menu link ${index + 1} down`} disabled={index === navigation.length - 1} onClick={() => { const links = [...navigation]; [links[index + 1], links[index]] = [links[index], links[index + 1]]; updateWebsite({ navigation: links }); }}><ArrowDown /></Button><Button variant="ghost" size="sm" onClick={() => updateWebsite({ navigation: navigation.map(link => link.id === item.id ? { ...link, enabled: !link.enabled } : link) })}>{item.enabled ? <Eye /> : <EyeOff />}{item.enabled ? "Hide link" : "Show link"}</Button><Button variant="ghost" size="icon-sm" aria-label={`Remove menu link ${index + 1}`} onClick={() => updateWebsite({ navigation: navigation.filter(link => link.id !== item.id) })}><Trash2 /></Button></div></div>)}<Button variant="outline" size="sm" disabled={navigation.length >= 16} onClick={() => updateWebsite({ navigation: [...navigation, { id: crypto.randomUUID(), label: "New link", link: "account", enabled: true }] })}><Plus />Add menu link</Button></EditorSettingsGroup>
        </>}<Button variant="outline" size="sm" onClick={() => setPanel("pages")}><LayoutTemplate />Manage pages</Button></>}
        {panel === "section" && (block === "footer" || block.startsWith("footer/")) && <><Label className="pb-field">Footer text<Textarea value={design.footer} maxLength={200} onChange={event => update("footer", event.target.value)} /></Label><Label className="pb-field">Support email<Input type="email" value={design.supportEmail} maxLength={254} onChange={event => update("supportEmail", event.target.value)} /></Label>{isWebsite && <><EditorSettingsGroup title="Footer elements"><EditorToggle label="Show footer" checked={website.footer?.enabled ?? true} onChange={enabled => updateWebsite({ footer: { ...website.footer, enabled } })} /><EditorToggle label="Footer brand name" checked={website.footer?.showBrand ?? true} onChange={showBrand => updateWebsite({ footer: { ...website.footer, showBrand } })} /><EditorToggle label="Footer support email" checked={website.footer?.showEmail ?? true} onChange={showEmail => updateWebsite({ footer: { ...website.footer, showEmail } })} /><EditorToggle label="Footer navigation" checked={website.footer?.showNavigation ?? false} onChange={showNavigation => updateWebsite({ footer: { ...website.footer, showNavigation } })} /></EditorSettingsGroup><EditorSettingsGroup title="Footer appearance"><EditorColor label="Footer background" value={website.footer?.background ?? ""} fallback="#ffffff" onChange={background => updateWebsite({ footer: { ...website.footer, background } })} /><EditorColor label="Footer text color" value={website.footer?.color ?? ""} onChange={color => updateWebsite({ footer: { ...website.footer, color } })} /><EditorRange label="Footer padding" min={8} max={100} value={website.footer?.padding ?? 32} onChange={padding => updateWebsite({ footer: { ...website.footer, padding } })} /></EditorSettingsGroup></>}</>}
        {panel === "section" && block === "shortcuts" && <><p className="pb-help">Account navigation shows the enabled account pages.</p><Button variant="outline" onClick={() => setPanel("pages")}>Manage account pages</Button><Button variant="ghost" onClick={() => setPanel("features")}>Customer permissions</Button></>}
        {panel === "page" && isWebsite && <><div className="pb-section-intro"><h2>{websitePage.title}</h2><p>B2B website page</p></div><Label className="pb-field">Page title<Input value={websitePage.title} maxLength={80} onChange={event => updateWebsitePage({ title: event.target.value })} /></Label>{websitePage.id !== "home" && <div className="pb-feature"><Label htmlFor="pb-website-visible">Visible in website</Label><Switch id="pb-website-visible" checked={websitePage.enabled} onCheckedChange={enabled => updateWebsitePage({ enabled })} /></div>}<Button variant="outline" size="sm" onClick={() => setPanel("pages")}><Plus />Manage website pages</Button>{websitePage.id !== "home" && <Button variant="destructive" size="sm" className="pb-remove-page" onClick={() => { update("website", { ...website, pages: website.pages.filter(item => item.id !== websitePage.id) }); selectPage("website/home"); }}><Trash2 />Remove this page</Button>}</>}
        {!isWebsite && (panel === "page" || (panel === "section" && selected && block === selected.id)) && <>
          
          {selected && <div className="pb-feature"><div><Label htmlFor="pb-page-visible">{selectedPage.type === "home" ? "Show payment overview" : "Visible to customers"}</Label></div><Switch id="pb-page-visible" checked={selected.enabled} onCheckedChange={enabled => updateSection(selected.id, { enabled })} /></div>}
          {selectedPage.type === "home" ? <><Label className="pb-field">Home heading (optional)<Input value={design.heading} maxLength={120} onChange={event => update("heading", event.target.value)} /></Label><Label className="pb-field">Home text (optional)<Textarea value={design.welcome} maxLength={300} rows={4} onChange={event => update("welcome", event.target.value)} /></Label></> : selected && <><Label className="pb-field">Page title<Input value={selected.title} maxLength={80} onChange={event => updateSection(selected.id, { title: event.target.value })} /></Label><Label className="pb-field">{selected.type === "content" ? "Page content" : "Page description"}<Textarea value={selected.body} maxLength={2000} rows={selected.type === "content" ? 9 : 4} onChange={event => updateSection(selected.id, { body: event.target.value })} /></Label></>}
          {selected?.type === "content" && <Button variant="destructive" size="sm" className="pb-remove-page" onClick={() => { update("sections", design.sections.filter(section => section.id !== selected.id)); selectPage("home"); }}><Trash2 />Remove this page</Button>}
        </>}
        {panel === "theme" && <>
          <Label className="pb-field">Theme name<Input aria-label="Theme name" value={name} maxLength={80} onChange={event => updateName(event.target.value)} /></Label><Label className="pb-field">Brand name<Input value={design.brandName} maxLength={80} onChange={event => update("brandName", event.target.value)} /></Label><Label className="pb-field">Logo URL<Input type="url" value={design.logoUrl} placeholder="https://yourbrand.com/logo.png" maxLength={2000} onChange={event => update("logoUrl", event.target.value)} /></Label>
          <div className="pb-field"><span>Brand color</span><div className="pb-colors">{colors.map(color => <button type="button" key={color} aria-label={`Use ${color}`} aria-pressed={design.accent === color} style={{ background: color }} onClick={() => update("accent", color)} />)}<input type="color" aria-label="Custom brand color" value={/^#[0-9a-f]{6}$/i.test(design.accent) ? design.accent : "#16776b"} onChange={event => update("accent", event.target.value)} /></div><Input aria-label="Brand color hex code" value={design.accent} maxLength={7} onChange={event => update("accent", event.target.value)} /></div>
          <Label className="pb-field">Visual style<PortalEditorSelect label="Visual style" value={design.theme} options={[{ value: "minimal", label: "Minimal" }, { value: "soft", label: "Soft" }, { value: "bold", label: "Bold" }]} onChange={next => update("theme", next as PortalDesign["theme"])} /></Label><Label className="pb-field">Announcement<Textarea value={design.announcement} maxLength={300} placeholder="" onChange={event => update("announcement", event.target.value)} /></Label><Label className="pb-field">Footer<Input value={design.footer} maxLength={200} onChange={event => update("footer", event.target.value)} /></Label><Label className="pb-field">Support email<Input type="email" value={design.supportEmail} maxLength={254} placeholder="support@yourbrand.com" onChange={event => update("supportEmail", event.target.value)} /></Label>
        </>}
        {panel === "features" && <>{([
          ["downloadInvoice", "Download invoices", "Requires a visible Invoices page."],
          ["sendMessages", "Send messages", "Turn off for read-only messages."],
          ["languageSwitcher", "Choose a language", ""],
        ] as const).map(([key, label, description]) => <div className="pb-feature" key={key}><div><Label htmlFor={`pb-feature-${key}`}>{label}</Label><p>{description}</p></div><Switch id={`pb-feature-${key}`} checked={design.features[key]} onCheckedChange={enabled => update("features", { ...design.features, [key]: enabled })} /></div>)}<Link href="/companies" className="pb-text-link">Go to companies<ArrowUp /></Link></>}
      </fieldset></div><div className="pb-editor-footer"><span><span className="pb-preview-dot" />Live preview</span><Button size="sm" variant="ghost" disabled={!canWrite || Boolean(busy) || !dirty} onClick={() => { setDesign(saved.draft); setName(savedName); setHistory({ past: [], future: [] }); selectPage("website/home"); setNotice(""); setError(""); }}><Undo2 />Discard edits</Button></div></aside>}
      <section className="pb-preview" aria-label="Portal preview"><div className={`pb-browser pb-device-${device}`}><div className="pb-portal-frame">{isWebsite ? <PortalWebsite design={design} preview page={page.slice("website/".length)} selectedSection={!interacting && ["section", "element", "elements"].includes(panel) ? block : undefined} onSectionSelect={interacting ? undefined : selectBlock} selectedElement={!interacting && panel === "element" && elementPath ? { sectionId: block, path: elementPath } : undefined} onElementSelect={interacting ? undefined : selectElement} onPageChange={next => selectPage(next === "account" ? "home" : `website/${next}`)} /> : <PortalExperience data={portalPreviewData(design)} preview page={selectedPage.id} onPageChange={selectPage} onWebsiteHome={() => selectPage("website/home")} />}</div></div>
      </section>
    </div>
  </div>;
}
