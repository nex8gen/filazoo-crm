"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { Fragment, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { CampaignDesignerRecovery } from "@/lib/campaign-editor-session";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Code, Columns2, Copy, Download, Eye, FileText, GripVertical, Image as ImageIcon, Layers, Loader2, Mail, Minus, Monitor, MoreHorizontal, MousePointer2, MoveVertical, Package, Palette, PanelLeftClose, PanelLeftOpen, PanelTop, Plus, Quote, Redo2, Save, Search, Share2, SlidersHorizontal, Smartphone, Square, Table2, Ticket, Trash2, Type, Undo2, Upload, Video } from "lucide-react";
import { EditorColorControl as ColorControl, EditorNumberControl as NumberControl, EditorSelect } from "@/components/email-editor-controls";
import { EmailSocialEditor } from "@/components/email-social-editor";
import { emailSocialSettings } from "@/lib/email-social";
import { EmailBlockStyleEditor, EmailBlockDisplayEditor, EmailBlockTypographyEditor } from "@/components/email-block-style-editor";
import { blockPresentation, blockInsets, cssInsets, borderCss, shadowCss, emailFonts } from "@/lib/email-block-config";
import { BlockSection } from "@/components/email-block-controls";
import { EmailProductEditor } from "@/components/email-product-editor";
import { EmailSplitEditor } from "@/components/email-split-editor";
import { EmailImageMaker } from "@/components/email-image-maker";
import { optimizeEmailImage } from "@/lib/email-image-client";
import { resolveEmailProductFeeds, inlinePrivateEmailImages } from "@/lib/email-products";
import { ColumnResizeHandle } from "@/components/column-resize-handle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createEmailPrebuilt, emailEditorCanSave, emailEditorHistory, resizeEmailColumns, type EmailPrebuiltLayout } from "@/lib/email-editor-state";
import { duplicateEmailBlock, emailDesignUrl, emailBlockName, emailDesignSchema, moveEmailBlock, newEmailBlock, removeEmailBlock, renderEmailBlockContent, renderEmailDesign, type EmailBlock, type EmailBlockType, type EmailDesign } from "@/lib/email-design";
import type { Product as MarketingProduct } from "@/lib/types";
import type { LibraryDocument } from "@/lib/documents";
import { isFullEmailHtml } from "@/lib/email-html-document";
import "./email-design-editor.css";

const palette = [
  { type: "text", label: "Text", icon: Type }, { type: "image", label: "Image", icon: ImageIcon }, { type: "columns", label: "Split", icon: Columns2 }, { type: "button", label: "Button", icon: MousePointer2 },
  { type: "header", label: "Header bar", icon: PanelTop }, { type: "section", label: "Drop shadow", icon: Square }, { type: "divider", label: "Divider", icon: Minus }, { type: "social", label: "Social links", icon: Share2 },
  { type: "spacer", label: "Spacer", icon: MoveVertical }, { type: "product", label: "Product", icon: Package }, { type: "coupon", label: "Coupon", icon: Ticket }, { type: "table", label: "Table", icon: Table2 },
  { type: "quote", label: "Review quote", icon: Quote }, { type: "video", label: "Video", icon: Video }, { type: "html", label: "HTML", icon: Code },
] as const;
const families = emailFonts;
function InlineText({ value, onChange, onSelect }: { value: string; onChange: (value: string) => void; onSelect: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const node = element.current; if (node && (node.innerText ?? node.textContent ?? "") !== value) node.textContent = value; }, [value]);
  return <div ref={element} contentEditable suppressContentEditableWarning role="textbox" aria-label="Edit text block" aria-multiline="true" onPaste={event => { event.preventDefault(); const node = event.currentTarget, text = event.clipboardData.getData("text/plain"), selection = window.getSelection(); if (selection?.rangeCount && node.contains(selection.anchorNode)) { const range = selection.getRangeAt(0), inserted = document.createTextNode(text); range.deleteContents(); range.insertNode(inserted); range.setStartAfter(inserted); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); } else node.textContent = (node.textContent ?? "") + text; onChange(node.innerText ?? node.textContent ?? ""); }} onFocus={onSelect} onClick={event => { event.stopPropagation(); onSelect(); }} onInput={event => onChange(event.currentTarget.innerText ?? event.currentTarget.textContent ?? "")} style={{ whiteSpace: "pre-wrap", outline: "none", minHeight: 24 }} />;
}

export function EmailDesignEditor({ initial, recovery, onCheckpoint, name, subject, products = [], template, saveOnDone = false, onEditDetails, detailsChanged = false, onSave, onApply, onClose }: { initial: EmailDesign; recovery?: CampaignDesignerRecovery; onCheckpoint?: (value: CampaignDesignerRecovery) => void; name: string; subject: string; products?: MarketingProduct[]; template?: LibraryDocument | null; saveOnDone?: boolean; onEditDetails?: () => void; detailsChanged?: boolean; onSave: (design: EmailDesign, name: string, existing?: LibraryDocument | null) => Promise<LibraryDocument>; onApply: (design: EmailDesign, template?: LibraryDocument | null) => void; onClose: () => void }) {
  const [history, dispatch] = useReducer(emailEditorHistory, { past: [], present: recovery?.design ?? initial, future: [] });
  const design = history.present;
  const displayDesign = resolveEmailProductFeeds(design, products);
  const latestDesign = useRef(design);
  useLayoutEffect(() => { latestDesign.current = design; }, [design]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [panel, setPanel] = useState<"blocks" | "layers" | "styles" | "block">("blocks");
  const [inspectorState, setInspectorState] = useState({ id: null as string | null, tab: "styles" as "content" | "styles" | "display" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(100);
  const [tab, setTab] = useState<"basic" | "prebuilt">("basic");
  const [selected, setSelected] = useState<string | null>(null);
  const inspectorTab = inspectorState.id === selected ? inspectorState.tab : design.blocks.find(block => block.id === selected)?.type === "columns" ? "content" : "styles";
  function setInspectorTab(tab: "content" | "styles" | "display") { setInspectorState({ id: selected, tab }); }
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState(recovery?.title ?? (template?.name || name || "New email template"));
  const [savedTemplate, setSavedTemplate] = useState<LibraryDocument | null>(recovery?.template ?? template ?? null);
  const [savedContent, setSavedContent] = useState<{ design: EmailDesign; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"close" | "clear" | EmailPrebuiltLayout | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const tableDrafts = useRef(new Map<string, string>());
  const [pendingTable, setPendingTable] = useState(false);
  const initialTitle = template?.name || name || "New email template";
  const imageInput = useRef<HTMLInputElement>(null);
  const sidebarScroll = useRef<HTMLDivElement>(null);
  const scrollShell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const regions = scrollShell.current?.querySelectorAll<HTMLElement>(".email-designer-sidebarScroll, .email-designer-workspace");
    const cleanups = Array.from(regions ?? [], region => {
      let idleTimer: number | undefined;
      const showScrollbar = () => {
        region.dataset.scrolling = "true";
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => { delete region.dataset.scrolling; }, 900);
      };
      region.addEventListener("scroll", showScrollbar, { passive: true });
      return () => {
        region.removeEventListener("scroll", showScrollbar);
        window.clearTimeout(idleTimer);
        delete region.dataset.scrolling;
      };
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, []);
  useLayoutEffect(() => { if (sidebarScroll.current) sidebarScroll.current.scrollTop = 0; }, [panel, selected]);
  const current = design.blocks.find(block => block.id === selected);
  const matchingPalette = palette.filter(item => item.label.toLowerCase().includes(search.trim().toLowerCase()));
  const changed = JSON.stringify(design) !== JSON.stringify(savedContent?.design ?? initial) || title !== (savedContent?.title ?? initialTitle) || pendingTable || uploading || detailsChanged;
  useEffect(() => { onCheckpoint?.({ initial, design, title, template: savedTemplate }); }, [initial, design, title, savedTemplate, onCheckpoint]);
  useEffect(() => {
    if (!changed) return;
    const preventLoss = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [changed]);
  function apply(update: EmailDesign | ((current: EmailDesign) => EmailDesign)) {
    const next = typeof update === "function" ? update(latestDesign.current) : update;
    const result = emailDesignSchema.safeParse(next);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Check the email layout."); return false; }
    latestDesign.current = result.data;
    setError(""); dispatch({ type: "change", design: result.data }); return true;
  }
  function changeBlock(values: Partial<EmailBlock>, id = selected) {
    if (id) apply(currentDesign => {
      const resized = values.columnCount ? resizeEmailColumns(currentDesign, id, values.columnCount) : currentDesign;
      return { ...resized, blocks: resized.blocks.map(block => block.id === id ? { ...block, ...values, ...(block.type === "header" && values.href !== undefined ? { presentation: { ...block.presentation, ...values.presentation, header: { ...block.presentation?.header, ...values.presentation?.header, logoHref: values.href } } } : {}) } : block) };
    });
  }
  function changeTheme(values: Partial<EmailDesign["theme"]>) {
    const design = latestDesign.current;
    const theme = { ...design.theme, ...values };
    const blocks = design.blocks.map(block => ({ ...block, ...(values.fontFamily && block.fontFamily === design.theme.fontFamily ? { fontFamily: values.fontFamily } : {}), ...(values.fontSize && block.fontSize === design.theme.fontSize ? { fontSize: values.fontSize } : {}), ...(values.textColor && block.color === design.theme.textColor ? { color: values.textColor } : {}), ...(values.accent && block.type === "button" && block.background === design.theme.accent ? { background: values.accent } : {}), ...(values.accent && block.type === "header" && block.color === design.theme.accent ? { color: values.accent } : {}) }));
    apply({ ...design, theme, blocks });
  }
  function add(type: EmailBlockType, parentId: string | null = null, column = 0, beforeId?: string, shadow = false, editorVariant?: EmailBlock["editorVariant"]) {
    const design = latestDesign.current;
    const block = newEmailBlock(type, { parentId, column, ...(type === "columns" || type === "section" ? { editorVariant: editorVariant ?? (type === "columns" ? "split" : shadow ? "drop-shadow" : "section") } : {}), fontFamily: design.theme.fontFamily, ...(type === "text" ? { fontSize: design.theme.fontSize, color: design.theme.textColor } : {}), ...(type === "button" ? { background: design.theme.accent } : {}), ...(type === "header" ? { color: design.theme.accent } : {}), ...(shadow ? { shadow: true, background: "#f2f2f2", radius: 0, padding: 0 } : {}) });
    const blocks = [...design.blocks]; const index = beforeId ? blocks.findIndex(item => item.id === beforeId) : -1; blocks.splice(index < 0 ? blocks.length : index, 0, block);
    if (apply({ ...design, blocks })) { setSelected(block.id); setPanel("block"); }
  }
  function onDrop(event: DragEvent<HTMLElement>, parentId: string | null, column: number, beforeId?: string) {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    const design = latestDesign.current;
    try {
      const data = JSON.parse(event.dataTransfer.getData("application/x-filazoo-email-block"));
      if (typeof data.id === "string") { const next = moveEmailBlock(design, data.id, parentId, column, beforeId); if (next === design && data.id !== beforeId) { setError("Choose a valid destination outside this block and its children."); return; } if (apply(next)) { setSelected(data.id); setPanel("block"); } }
      else if (palette.some(item => item.type === data.type)) add(data.type, parentId, column, beforeId, data.shadow === true, data.editorVariant);
      else setError("Drop a content block from the sidebar.");
    } catch { setError("Drop a content block from the sidebar."); }
  }
  function duplicate(id = current?.id) { if (id) { const result = duplicateEmailBlock(latestDesign.current, id); if (apply(result.design)) setSelected(result.id); } }
  function reorder(direction: -1 | 1) {
    if (!current) return;
    const design = latestDesign.current;
    const siblings = design.blocks.filter(block => block.parentId === current.parentId && block.column === current.column);
    const index = siblings.findIndex(block => block.id === current.id), target = siblings[index + direction];
    if (!target) return;
    const beforeId = direction < 0 ? target.id : siblings[index + 2]?.id;
    apply(moveEmailBlock(design, current.id, current.parentId, current.column, beforeId));
  }
  async function save(asNew = false, closeAfter = false) {
    if (!title.trim()) { setError("Enter a template name."); return; }
    if (!flushTables()) return;
    const editingSnapshot = latestDesign.current;
    const snapshot = resolveEmailProductFeeds(editingSnapshot, products);
    if (!emailEditorCanSave(snapshot)) { setError("Add email content before saving a template."); return; }
    setBusy(true); setError("");
    try { setSavedTemplate(await onSave(snapshot, title.trim(), asNew ? null : savedTemplate)); if (saveOnDone) setSavedContent({ design: editingSnapshot, title }); if (closeAfter) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save the template."); }
    finally { setBusy(false); }
  }
  async function exportHtml() {
    if (!flushTables()) return;
    let snapshot: EmailDesign;
    try { snapshot = await inlinePrivateEmailImages(resolveEmailProductFeeds(latestDesign.current, products), async src => { const response = await fetch(src); if (!response.ok) throw new Error("Unable to export a private product image."); const blob = await response.blob(); return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Unable to read a product image.")); reader.readAsDataURL(blob); }); }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to export product images."); return; }
    const url = URL.createObjectURL(new Blob([renderEmailDesign(snapshot).html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${title.replace(/[^a-z0-9]+/gi, "-").slice(0, 80) || "email"}.html`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function upload(file?: File, targetId = current?.id) {
    const target = latestDesign.current.blocks.find(block => block.id === targetId);
    if (!file || !target || uploading) return;
    const blockId = target.id, originalAlt = target.alt; setUploading(true); setError("");
    try {
      const optimized = await optimizeEmailImage(file);
      if (!mounted.current) return;
      const reader = new FileReader(); reader.onload = () => { if (!mounted.current) return; const currentTarget = latestDesign.current.blocks.find(block => block.id === blockId); if (currentTarget) changeBlock({ src: String(reader.result), ...(currentTarget.alt === originalAlt ? { alt: file.name.replace(/\.[^.]+$/, "") } : {}) }, blockId); setUploading(false); }; reader.onerror = () => { if (mounted.current) { setError("Unable to read this image."); setUploading(false); } }; reader.onabort = () => { if (mounted.current) setUploading(false); }; reader.readAsDataURL(optimized);
    } catch (cause) { if (mounted.current) { setError(cause instanceof Error ? cause.message : "Unable to optimize the image."); setUploading(false); } }
  }
  function chooseColumnContent(column: number, type: EmailBlockType) {
    if (!current || current.type !== "columns") return;
    apply(value => {
      const existing = value.blocks.find(block => block.parentId === current.id && block.column === column);
      const blocks = existing && ["text", "image", "html"].includes(existing.type) ? value.blocks.map(block => block.id === existing.id ? { ...block, type } : block) : [...value.blocks, newEmailBlock(type, { parentId: current.id, column })];
      return { ...value, blocks };
    });
  }
  function prebuilt(kind: EmailPrebuiltLayout) { apply(createEmailPrebuilt(kind, latestDesign.current.theme)); setSelected(null); setPanel("blocks"); }
  function addAtSelection(type: EmailBlockType, shadow = false, editorVariant?: EmailBlock["editorVariant"]) {
    const current = latestDesign.current.blocks.find(block => block.id === selected);
    if (current && ["columns", "section"].includes(current.type)) { add(type, current.id, 0, undefined, shadow, editorVariant); return; }
    const siblings = latestDesign.current.blocks.filter(block => block.parentId === (current?.parentId ?? null) && block.column === (current?.column ?? 0));
    const index = current ? siblings.findIndex(block => block.id === current.id) : -1;
    add(type, current?.parentId ?? null, current?.column ?? 0, index >= 0 ? siblings[index + 1]?.id : undefined, shadow, editorVariant);
  }

  function commitTable(id: string, value: string) {
    const rows = value.trim() ? value.split("\n").map(row => row.split("|").map(cell => cell.trim())) : [];
    if (rows.length > 20 || rows.some(row => row.length > 6)) { tableDrafts.current.set(id, value); setPendingTable(true); setError("Use at most 20 rows and 6 columns in a table."); return false; }
    changeBlock({ rows }, id); tableDrafts.current.delete(id); setPendingTable(tableDrafts.current.size > 0); return true;
  }
  function flushTables() {
    for (const [id, value] of tableDrafts.current) {
      if (!latestDesign.current.blocks.some(block => block.id === id)) { tableDrafts.current.delete(id); continue; }
      if (!commitTable(id, value)) return false;
    }
    setPendingTable(false); return true;
  }
  function dropZone(parentId: string | null, column: number, beforeId?: string, empty = false) {
    const key = `${parentId ?? "root"}:${column}:${beforeId ?? "end"}`;
    return <div className={`email-designer-dropZone${beforeId ? " is-insert" : empty ? "" : " is-small"}`} data-drop-parent={parentId ?? "root"} data-drop-column={column} data-drop-before={beforeId ?? "end"} data-drag-over={dropTarget === key || undefined} onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === "move" ? "move" : "copy"; setDropTarget(key); }} onDragLeave={() => setDropTarget(value => value === key ? null : value)} onDrop={event => onDrop(event, parentId, column, beforeId)} onClick={event => event.stopPropagation()}>{!beforeId ? <><Plus /><span>Drop content here</span><button type="button" aria-label={`Add text to ${parentId ? "layout" : "email"} column ${column + 1}`} onClick={event => { event.stopPropagation(); add("text", parentId, column); }}>Add text</button></> : <span>Drop here</span>}</div>;
  }
  function renderBlocks(parentId: string | null, column = 0) {
    const blocks = displayDesign.blocks.filter(block => block.parentId === parentId && block.column === column);
    return <div className="email-designer-dropArea" onDragOver={event => { event.preventDefault(); event.stopPropagation(); setDropTarget(`${parentId ?? "root"}:${column}:end`); }} onDrop={event => onDrop(event, parentId, column)}>
      {blocks.map(block => { const p = blockPresentation(block); const mobileStack = viewport === "mobile" && p.columns.stack !== "none"; const order = Array.from({ length: block.columnCount }, (_, i) => i); if (mobileStack && p.columns.stack === "right") order.reverse(); const areaStyle = { padding: cssInsets(p.areaPadding), background: p.areaBackground, border: borderCss(p.border), borderRadius: block.radius }; const visible = viewport === "mobile" ? block.type === "social" ? emailSocialSettings(block).showMobile : p.showMobile : block.type === "social" ? emailSocialSettings(block).showDesktop : p.showDesktop; return <Fragment key={block.id}>{dropZone(parentId, column, block.id)}<div data-block-id={block.id} role="group" tabIndex={0} aria-label={`${emailBlockName(block)} block`} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelected(block.id); setPanel("block"); } }} className={`email-designer-block${selected === block.id ? " is-selected" : ""}`} onClick={event => { event.stopPropagation(); event.preventDefault(); setSelected(block.id); setPanel("block"); }} onDragOver={event => { event.preventDefault(); event.stopPropagation(); setDropTarget(`${parentId ?? "root"}:${column}:${block.id}`); }} onDrop={event => onDrop(event, parentId, column, block.id)}>
        <div className="email-designer-blockBar"><span>{emailBlockName(block)}</span><button type="button" draggable aria-label={`Drag ${emailBlockName(block)} block`} onDragStart={event => { event.dataTransfer.setData("application/x-filazoo-email-block", JSON.stringify({ id: block.id })); event.dataTransfer.effectAllowed = "move"; }}><GripVertical /></button><button type="button" aria-label="Duplicate block" onClick={event => { event.stopPropagation(); const result = duplicateEmailBlock(design, block.id); apply(result.design); setSelected(result.id); }}><Copy /></button><button type="button" aria-label="Delete block" onClick={event => { event.stopPropagation(); apply(removeEmailBlock(latestDesign.current, block.id)); setSelected(null); setPanel("blocks"); }}><Trash2 /></button></div>
        <div className="email-designer-blockContent" style={{ padding: cssInsets(blockInsets(block, viewport === "mobile")), backgroundColor: p.blockBackground, backgroundImage: emailDesignUrl(p.backgroundImage, true, true) ? `url(${JSON.stringify(emailDesignUrl(p.backgroundImage, true, true))})` : undefined, backgroundSize: "cover", backgroundPosition: "center", minHeight: p.minHeight || undefined, lineHeight: p.lineHeight, color: block.color, fontFamily: block.fontFamily, fontSize: block.fontSize, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? "italic" : "normal", textDecoration: [block.underline && "underline", p.strike && "line-through"].filter(Boolean).join(" ") || "none", letterSpacing: p.letterSpacing, textAlign: block.align, borderRadius: block.radius, boxShadow: block.type !== "button" ? shadowCss(block) : undefined } as CSSProperties}>
          {!visible ? <div className="email-designer-hiddenBlock">{emailBlockName(block)} hidden on {viewport}. Change this in Display.</div> : block.type === "columns" ? <div style={areaStyle}><div className="email-designer-columns" style={{ gap: p.columns.gap, gridTemplateColumns: mobileStack ? "minmax(0,1fr)" : p.columns.widths.map(width => `minmax(0,${width}fr)`).join(" ") }}>{order.map(index => <div key={index}>{renderBlocks(block.id, index)}</div>)}</div></div> : block.type === "section" ? <div style={areaStyle}>{renderBlocks(block.id)}</div> : block.type === "text" ? <div style={areaStyle}><InlineText value={block.text} onChange={text => changeBlock({ text }, block.id)} onSelect={() => { setSelected(block.id); setPanel("block"); }} /></div> : ["image", "product", "video"].includes(block.type) && !block.src && !(block.type === "product" && block.product?.cards.length) ? <div className="email-designer-imagePlaceholder"><ImageIcon /><span>{block.type === "product" ? block.product ? block.product.mode === "dynamic" ? "No matching products. Edit your feed." : "Choose catalog products." : block.heading : block.type === "video" ? "Add video thumbnail" : "Add image"}</span>{block.type === "product" && !block.product && block.text ? <small>{block.text}</small> : null}</div> : block.type === "html" && isFullEmailHtml(block.html) ? <iframe title="Original email design" sandbox="allow-same-origin" onLoad={event => { const frame = event.currentTarget; frame.style.height = Math.max(1100, frame.contentDocument?.documentElement.scrollHeight ?? 1100) + "px"; }} srcDoc={renderEmailDesign({ ...displayDesign, blocks: [block] }, { preview: true }).html} style={{ width: "100%", height: 1100, border: 0, pointerEvents: "none" }} /> : <div dangerouslySetInnerHTML={{ __html: renderEmailBlockContent(block, { viewport, preview: true }) }} />}
        </div>
      </div></Fragment>; })}
      {dropZone(parentId, column, undefined, !blocks.length)}
    </div>;
  }

  function renderLayers(parentId: string | null, depth = 0) {
    return <ul className="email-designer-layerList" aria-label={parentId ? "Nested blocks" : "Email layers"}>{design.blocks.filter(block => block.parentId === parentId).map(block => {
      const Icon = palette.find(item => item.type === block.type)?.icon ?? Square;
      return <li key={block.id}>
        <button type="button" className="email-designer-layer" aria-label={`Select ${emailBlockName(block)} layer: ${(block.heading || block.text || emailBlockName(block)).slice(0, 60)}`} aria-pressed={selected === block.id} style={{ paddingInlineStart: 12 + depth * 16 }} onClick={() => { setSelected(block.id); setPanel("block"); }}><Icon /><span><strong>{emailBlockName(block)}</strong><small>{block.heading || block.text || (block.type === "columns" ? `${block.columnCount} columns` : "Select to edit")}</small></span>{parentId && design.blocks.find(item => item.id === parentId)?.type === "columns" ? <small>Col {block.column + 1}</small> : null}</button>
        {design.blocks.some(item => item.parentId === block.id) ? renderLayers(block.id, depth + 1) : null}
      </li>;
    })}</ul>;
  }

  const contentEditor = current ? <>{current.type === "header" && !current.src ? <label className="email-designer-field">Logo text<Input aria-label="Logo text" value={current.text} maxLength={300} onChange={event => changeBlock({ text: event.target.value })} /></label> : null}{current.type === "section" ? <p className="email-designer-propertyHint">Add blocks inside this section from Insert, or use its drop area on the canvas.</p> : null}
          {["text", "button", "coupon", "quote", "product", "video"].includes(current.type) ? <label className="email-designer-field">{current.type === "button" ? "Button text" : current.type === "coupon" ? "Coupon code" : "Text"}<Textarea value={current.text} maxLength={12000} rows={5} onChange={event => changeBlock({ text: event.target.value })} /></label> : null}
          {["product", "coupon", "quote"].includes(current.type) ? <label className="email-designer-field">Heading<Input value={current.heading} maxLength={300} onChange={event => changeBlock({ heading: event.target.value })} /></label> : null}
          {current.type === "product" ? <EditorSelect label="Product" value={current.productSku} options={[{ value: "", label: "Select product" }, ...products.map(product => ({ value: product.sku, label: product.name }))]} onChange={productSku => { const product = products.find(item => item.sku === productSku); changeBlock({ productSku, ...(product ? { heading: product.name, text: product.material, src: product.imageUrl ?? "", alt: product.name } : {}) }); }} /> : null}
          {["image", "product", "header", "video"].includes(current.type) ? <>
            <div className="email-designer-uploadSection"><span>Upload an image</span><div className="email-designer-uploadDrop" data-has-image={!!current.src || undefined} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); upload(event.dataTransfer.files[0]); } }}>
              {current.src ? <div className="email-designer-uploadPreview">
              {/* User images include data URLs and arbitrary external hosts. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.src} alt={current.alt || "Selected image"} /></div> : <><ImageIcon /><strong>Drag and drop an image</strong><p>PNG, JPG, GIF, or WebP<br />Static images up to 10 MB are optimized for email. GIFs up to 750 KB keep their animation.</p></>}
              <div className="email-designer-uploadButtons"><Button variant="outline" size="sm" disabled={uploading} onClick={() => imageInput.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <Upload />}{current.src ? "Replace image" : "Select image"}</Button>
              <EmailImageMaker disabled={uploading} onCreate={(src, alt) => changeBlock({ src, alt })} /><input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { upload(event.target.files?.[0]); event.target.value = ""; }} /></div>
              {current.src ? <Button variant="ghost" size="sm" onClick={() => changeBlock({ src: "" })}>Remove image</Button> : null}
            </div></div>
            <label className="email-designer-field">Image URL<Input placeholder="https://" maxLength={2000} value={current.src.startsWith("data:") ? "Uploaded image" : current.src} readOnly={current.src.startsWith("data:")} onChange={event => changeBlock({ src: event.target.value })} /></label>
            <label className="email-designer-field">Alt text<Input value={current.alt} maxLength={300} onChange={event => changeBlock({ alt: event.target.value })} /></label>
            {current.type !== "image" && current.type !== "header" ? <NumberControl label="Image width" value={current.width} min={20} max={1200} onChange={width => changeBlock({ width })} /> : null}
          </> : null}
          {["image", "button", "product", "video", "header"].includes(current.type) ? <label className="email-designer-field">{current.type === "video" ? "Video URL" : "Link URL"}<Input value={current.href} placeholder="https://…" maxLength={2000} onChange={event => changeBlock({ href: event.target.value })} /></label> : null}

          {current.type === "html" ? <label className="email-designer-field">HTML content<Textarea className="email-designer-code" value={current.html} maxLength={3000000} rows={14} onChange={event => changeBlock({ html: event.target.value })} /></label> : null}
          {current.type === "table" ? <label className="email-designer-field">Table content<Textarea key={current.id + JSON.stringify(current.rows)} rows={8} defaultValue={current.rows.map(row => row.join(" | ")).join("\n")} onChange={event => { tableDrafts.current.set(current.id, event.target.value); setPendingTable(true); }} onBlur={event => commitTable(current.id, event.target.value)} /><small>One row per line. Separate columns with |.</small></label> : null}
          {["spacer", "divider"].includes(current.type) ? <NumberControl label="Height" value={current.height} min={1} max={400} onChange={height => changeBlock({ height })} /> : null}
          </> : null;
  const headerLinks = current ? <>{current.type === "header" ? <div className="email-designer-links">{current.links.map((link, index) => <details className="email-designer-linkCard" key={index} open><summary><ChevronDown /><span>{link.label || "Link " + (index + 1)}</span><Button variant="ghost" size="icon-xs" aria-label="Remove link" title="Remove link" onClick={event => { event.preventDefault(); changeBlock({ links: current.links.filter((_, i) => i !== index) }); }}><Trash2 /></Button></summary><div><Input aria-label={"Link " + (index + 1) + " label"} placeholder="Label" value={link.label} onChange={event => changeBlock({ links: current.links.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /><Input aria-label={"Link " + (index + 1) + " URL"} placeholder="https://" value={link.href} onChange={event => changeBlock({ links: current.links.map((item, i) => i === index ? { ...item, href: event.target.value } : item) })} />{link.kind === "icon" ? <Input aria-label={"Link " + (index + 1) + " image URL"} placeholder="Image URL" value={link.customSrc ?? ""} maxLength={2000} onChange={event => changeBlock({ links: current.links.map((item, i) => i === index ? { ...item, customSrc: event.target.value } : item) })} /> : null}</div></details>)}<Button size="sm" variant="outline" disabled={current.links.length >= 10} onClick={() => changeBlock({ links: [...current.links, { label: "Link", href: "" }] })}><Plus />Add link</Button><Button size="sm" variant="outline" disabled={current.links.length >= 10} onClick={() => changeBlock({ links: [...current.links, { label: "Image", href: "", kind: "icon", customSrc: "" }] })}><ImageIcon />Add image link</Button></div> : null}</> : null;
  return <div className="email-designer" onDragEnd={() => setDropTarget(null)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); } }}><header className="email-designer-header"><div><Button variant="ghost" size="icon-sm" aria-label={saveOnDone ? "Back to templates" : "Back to message"} title={saveOnDone ? "Back to templates" : "Back to message"} disabled={busy || uploading} onClick={() => changed || tableDrafts.current.size ? setConfirm("close") : onClose()}><ArrowLeft /></Button><Mail className="email-designer-documentIcon" /><Input aria-label="Template name" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></div><span className="email-designer-status"><i />{changed ? "Editing" : "Email designer"}</span><div><DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={busy || uploading} />}>Manage template<ChevronDown /></DropdownMenuTrigger><DropdownMenuContent align="end">{onEditDetails ? <DropdownMenuItem onClick={onEditDetails}><SlidersHorizontal />Template settings</DropdownMenuItem> : null}<DropdownMenuItem onClick={() => void save()}><Save />{savedTemplate ? "Save template" : "Save as template"}</DropdownMenuItem><DropdownMenuItem onClick={() => void save(true)}><Copy />Save as new template</DropdownMenuItem><DropdownMenuItem onClick={exportHtml}><Download />Export HTML</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setConfirm("clear")}><Trash2 />Clear content</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button variant="outline" size="sm" onClick={() => { if (flushTables()) setPreview(true); }}><Eye />Preview</Button><Button size="sm" disabled={busy || uploading} onClick={() => { if (saveOnDone) { void save(false, true); return; } if (flushTables() && emailDesignSchema.safeParse(latestDesign.current).success) onApply(resolveEmailProductFeeds(latestDesign.current, products), savedTemplate); }}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{saveOnDone ? "Save template" : "Done"}</Button></div></header>
    {error ? <NotificationToast>{error}</NotificationToast> : null}
    <div ref={scrollShell} className="email-designer-shell" data-sidebar-collapsed={sidebarCollapsed || undefined}>
      <nav className="email-designer-rail" aria-label="Email editor tools">{[{ id: "blocks", aria: "Add content", icon: Plus }, { id: "styles", aria: "Edit styles", icon: Palette }, { id: "layers", aria: "Layers", icon: Layers }, { id: "block", aria: "Edit selected block", icon: SlidersHorizontal }].map(item => <button key={item.id} type="button" title={item.aria} aria-label={item.aria} aria-pressed={panel === item.id} disabled={item.id === "block" && !current} onClick={() => { setPanel(item.id as typeof panel); setSidebarCollapsed(false); }}><item.icon /></button>)}{sidebarCollapsed ? <button type="button" title="Expand design sidebar" aria-label="Expand design sidebar" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen /></button> : null}</nav>
      <aside className="email-designer-sidebar" aria-label="Design sidebar" data-panel={panel} inert={sidebarCollapsed}>
      <div className="email-designer-sidebarTitle">{panel === "block" && current ? <Button size="icon-sm" variant="ghost" title="Back to content blocks" aria-label="Back to content blocks" onClick={() => setPanel("blocks")}><ArrowLeft /></Button> : null}<strong>{panel === "block" && current ? emailBlockName(current) : panel === "styles" ? "Edit styles" : panel === "layers" ? "Layers" : "Add content"}</strong>{panel === "block" && current ? <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Block actions" title="Block actions"><MoreHorizontal /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem title="Move block up" aria-label="Move block up" onClick={() => reorder(-1)}><ArrowUp /></DropdownMenuItem><DropdownMenuItem title="Move block down" aria-label="Move block down" onClick={() => reorder(1)}><ArrowDown /></DropdownMenuItem><DropdownMenuItem title="Duplicate selected block" aria-label="Duplicate selected block" onClick={() => duplicate()}><Copy /></DropdownMenuItem><DropdownMenuItem title="Delete selected block" aria-label="Delete selected block" onClick={() => { apply(removeEmailBlock(design, current.id)); setSelected(null); setPanel("blocks"); }}><Trash2 /></DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}<Button size="icon-sm" variant="ghost" title="Collapse design sidebar" aria-label="Collapse design sidebar" onClick={() => setSidebarCollapsed(true)}><PanelLeftClose /></Button></div>
      <div ref={sidebarScroll} className="email-designer-sidebarScroll">
      <div className="email-designer-sidebarBody">
        {panel === "layers" ? <>{design.blocks.length ? renderLayers(null) : <div className="email-designer-empty"><Layers /><strong>Your canvas is ready</strong><p>Add your first block to start building an email.</p><Button variant="outline" onClick={() => setPanel("blocks")}><Plus />Add content</Button></div>}</> : null}
        {panel === "blocks" || (panel === "block" && !current) ? <>
          <div className="email-designer-paletteTabs"><Button variant="ghost" size="sm" aria-pressed={tab === "basic"} onClick={() => setTab("basic")}>Basic</Button><Button variant="ghost" size="sm" aria-pressed={tab === "prebuilt"} onClick={() => setTab("prebuilt")}>Pre-built</Button></div>
          {tab === "basic" ? <>
            <label className="email-designer-search"><Search /><Input aria-label="Search blocks" placeholder="Search blocks" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button type="button" aria-label="Clear block search" onClick={() => setSearch("")}>Clear</button> : null}</label>
            {matchingPalette.length ? <><h3 className="email-designer-sectionLabel">Blocks</h3><div className="email-designer-palette">{matchingPalette.map(item => <button key={item.label} type="button" aria-label={item.label} draggable title={"Insert " + item.label.toLowerCase()} onDragStart={event => { event.dataTransfer.setData("application/x-filazoo-email-block", JSON.stringify({ type: item.type, shadow: item.label === "Drop shadow" })); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addAtSelection(item.type, item.label === "Drop shadow")}><span className="email-designer-blockPreview" aria-hidden="true" data-type={item.type} data-variant={item.label === "Drop shadow" ? "shadow" : item.label === "Split" ? "split" : item.type}><item.icon /><i /><i /><i /></span><span>{item.label}</span></button>)}</div></> : null}
            {[{ type: "columns", label: "Columns", icon: Columns2 }, { type: "section", label: "Section", icon: Square }].some(item => item.label.toLowerCase().includes(search.trim().toLowerCase())) ? <><h3 className="email-designer-sectionLabel">Layout</h3><div className="email-designer-palette">{[{ type: "columns", label: "Columns", icon: Columns2 }, { type: "section", label: "Section", icon: Square }].filter(item => item.label.toLowerCase().includes(search.trim().toLowerCase())).map(item => <button key={item.type} type="button" aria-label={item.label} draggable onDragStart={event => { event.dataTransfer.setData("application/x-filazoo-email-block", JSON.stringify({ type: item.type, editorVariant: item.type })); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addAtSelection(item.type as EmailBlockType, false, item.type as "columns" | "section")}><span className="email-designer-blockPreview" data-type={item.type}><item.icon /><i /><i /><i /></span><span>{item.label}</span></button>)}</div></> : !matchingPalette.length ? <div className="email-designer-empty"><Search /><strong>No matching blocks</strong><p>Try text, image, button, or columns.</p></div> : null}
          </> : <div className="email-designer-prebuilt">{[{ id: "welcome", title: "Welcome email", description: "A warm first impression", icon: Mail }, { id: "products", title: "Product spotlight", description: "Put your products in focus", icon: Package }, { id: "newsletter", title: "Newsletter", description: "Share your latest updates", icon: FileText }].map(item => <button key={item.id} type="button" onClick={() => latestDesign.current.blocks.length ? setConfirm(item.id as EmailPrebuiltLayout) : prebuilt(item.id as EmailPrebuiltLayout)}><item.icon /><span><strong>{item.title}</strong><small>{item.description}</small></span><Plus /></button>)}</div>}
        </> : null}
        {panel === "styles" ? <>
          <BlockSection title="Background"><ColorControl label="Template background" value={design.theme.background} onChange={background => changeTheme({ background })} /><ColorControl label="Content background" value={design.theme.contentBackground} onChange={contentBackground => changeTheme({ contentBackground })} /><ColorControl label="Accent color" value={design.theme.accent} onChange={accent => changeTheme({ accent })} /></BlockSection>
          <BlockSection title="Background image" collapsed={!design.theme.backgroundImage}><label className="email-designer-field">Image URL<Input aria-label="Background image" placeholder="https://" value={design.theme.backgroundImage} onChange={event => changeTheme({ backgroundImage: event.target.value })} /></label></BlockSection>
          <BlockSection title="Layout"><NumberControl label="Width" value={design.theme.width} min={320} max={900} onChange={width => changeTheme({ width })} /><NumberControl label="Corner radius" value={design.theme.radius} max={40} onChange={radius => changeTheme({ radius })} /><NumberControl label="Margin top" value={design.theme.marginTop} max={120} onChange={marginTop => changeTheme({ marginTop })} /><NumberControl label="Padding" value={design.theme.padding} max={80} onChange={padding => changeTheme({ padding })} /></BlockSection>
          <BlockSection title="Text and headings"><EditorSelect label="Font" font value={design.theme.fontFamily} options={families.map(font => ({ value: font, label: font }))} onChange={fontFamily => changeTheme({ fontFamily: fontFamily as EmailDesign["theme"]["fontFamily"] })} /><NumberControl label="Font size" value={design.theme.fontSize} min={10} max={32} onChange={fontSize => changeTheme({ fontSize })} /><ColorControl label="Text color" value={design.theme.textColor} onChange={textColor => changeTheme({ textColor })} /></BlockSection>
        </> : null}
        {panel === "block" && current ? current.type === "social" ? <EmailSocialEditor key={current.id} block={current} onChange={changeBlock} /> : <Fragment key={current.id}><nav className="email-block-tabs" aria-label="Block settings">{current.type === "columns" ? <button type="button" aria-pressed={inspectorTab === "content"} onClick={() => setInspectorTab("content")}>Content</button> : null}<button type="button" aria-pressed={inspectorTab === "styles"} onClick={() => setInspectorTab("styles")}>Styles</button><button type="button" aria-pressed={inspectorTab === "display"} onClick={() => setInspectorTab("display")}>Display</button></nav>{inspectorTab === "display" ? <EmailBlockDisplayEditor block={current} onChange={changeBlock} /> : <>
          {current.type === "columns" && inspectorTab === "content" ? <EmailSplitEditor block={current} design={design} onChangeChild={(id, values) => changeBlock(values, id)} onChooseType={chooseColumnContent} onUpload={(file, id) => void upload(file, id)} uploading={uploading} /> : null}
          {current.type === "product" ? <EmailProductEditor key={current.id} block={current} products={products} onChange={changeBlock} /> : null}
          {current.type === "spacer" ? <BlockSection title="Height"><NumberControl compact label="Height" value={current.height} min={1} max={400} onChange={height => changeBlock({ height })} /></BlockSection> : null}
          {current.type !== "columns" && current.type !== "section" && current.type !== "spacer" && current.type !== "divider" && current.type !== "header" && !(current.type === "product" && current.product) ? <BlockSection collapsed={current.type === "product" ? true : undefined} title={current.type === "image" ? "Image" : current.type === "button" ? "Button text" : current.type === "product" ? "Custom product content" : emailBlockName(current)}>{contentEditor}{["text", "button", "coupon", "quote", "video", "table"].includes(current.type) ? <EmailBlockTypographyEditor block={current} onChange={changeBlock} /> : null}</BlockSection> : null}

          {inspectorTab === "styles" ? <EmailBlockStyleEditor block={current} onChange={changeBlock} hideTypography={["text", "button", "coupon", "quote", "video", "table"].includes(current.type)} headerLogo={current.type === "header" ? contentEditor : undefined} headerContent={headerLinks} /> : null}
        </>}</Fragment> : null}
      </div></div><footer className="email-designer-sidebarFooter"><MousePointer2 /><span>{current ? "Selected: " + emailBlockName(current) : "Select a block on the canvas to edit"}</span></footer>
      <ColumnResizeHandle label="Resize design sidebar" variable="--email-editor-sidebar-width" container=".email-designer-shell" panel=".email-designer-sidebar" remainingPanel=".email-designer-workspace" minRemaining={360} min={288} max={440} storageKey="email-design-sidebar" className="email-designer-resize" />
    </aside><main className="email-designer-workspace" style={{ backgroundColor: design.theme.background, backgroundImage: design.theme.backgroundImage && /^https?:\/\//i.test(design.theme.backgroundImage) ? `url(${JSON.stringify(design.theme.backgroundImage)})` : undefined }}>
      <div className="email-designer-canvasToolbar"><Button size="icon-sm" variant="ghost" title="Undo" aria-label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: "undo" })}><Undo2 /></Button><Button size="icon-sm" variant="ghost" title="Redo" aria-label="Redo" disabled={!history.future.length} onClick={() => dispatch({ type: "redo" })}><Redo2 /></Button><span className="email-designer-toolbarDivider" /><Button size="icon-sm" variant={viewport === "desktop" ? "secondary" : "ghost"} title="Desktop preview" aria-label="Desktop preview" aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")}><Monitor /></Button><Button size="icon-sm" variant={viewport === "mobile" ? "secondary" : "ghost"} title="Mobile preview" aria-label="Mobile preview" aria-pressed={viewport === "mobile"} onClick={() => setViewport("mobile")}><Smartphone /></Button><span className="email-designer-toolbarDivider" /><label className="email-designer-zoom"><span className="sr-only">Canvas zoom</span><select aria-label="Canvas zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[50, 75, 100, 125, 150].map(value => <option key={value} value={value}>{value}%</option>)}</select></label></div>
      <div className="email-designer-canvasLabel"><Mail /><span>{viewport === "mobile" ? "Mobile" : "Desktop"}</span><span>{viewport === "mobile" ? 375 : design.theme.width} px</span></div>
      <div className="email-designer-page" lang="en" translate="no" data-no-translate style={{ zoom: zoom / 100, width: viewport === "mobile" ? 375 : design.theme.width, backgroundColor: design.theme.contentBackground, color: design.theme.textColor, fontFamily: design.theme.fontFamily, fontSize: design.theme.fontSize, borderRadius: design.theme.radius, marginTop: design.theme.marginTop, padding: design.theme.padding }} onClick={() => { setSelected(null); setPanel("blocks"); }}>{renderBlocks(null)}</div>
      <p className="email-designer-canvasHint">Click any block to edit &middot; Drag blocks to arrange your layout</p>
    </main></div>
    <Dialog open={preview} onOpenChange={setPreview}><DialogContent className="!z-[90] !w-[min(1000px,calc(100vw-32px))] !max-w-none"><DialogHeader><DialogTitle>Email preview</DialogTitle><DialogDescription>{subject || title}</DialogDescription></DialogHeader><div className="email-designer-previewActions"><Button variant={viewport === "desktop" ? "secondary" : "ghost"} size="sm" onClick={() => setViewport("desktop")}><Monitor />Desktop</Button><Button variant={viewport === "mobile" ? "secondary" : "ghost"} size="sm" onClick={() => setViewport("mobile")}><Smartphone />Mobile</Button></div><iframe title="Designed email preview" sandbox="allow-same-origin" srcDoc={renderEmailDesign(displayDesign, { preview: true }).html} className="email-designer-previewFrame" style={{ width: viewport === "mobile" ? "375px" : "100%" }} /></DialogContent></Dialog>
    <Dialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null); }}><DialogContent className="!z-[90]"><DialogHeader><DialogTitle>{confirm === "clear" ? "Clear the email content?" : confirm === "close" ? "Discard editor changes?" : "Replace the current layout?"}</DialogTitle><DialogDescription>{confirm === "clear" ? "You can restore the content with Undo." : confirm === "close" ? (saveOnDone ? "Save your template before leaving to keep your changes." : "Choose Done to keep your changes in this campaign.") : "The pre-built layout will replace your current blocks. Your styles are kept, and Undo can restore the previous layout."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Keep editing</Button><Button variant="destructive" onClick={() => { if (confirm === "clear") { tableDrafts.current.clear(); setPendingTable(false); apply({ ...latestDesign.current, blocks: [] }); setSelected(null); setPanel("blocks"); setConfirm(null); } else if (confirm === "close") onClose(); else if (confirm) { prebuilt(confirm); setConfirm(null); } }}>{confirm === "clear" ? "Clear content" : confirm === "close" ? "Discard changes" : "Replace layout"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
