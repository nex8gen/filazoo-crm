"use client";

import { useEffect, useReducer, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, Bold, Check, ChevronDown, Code, Columns2, Copy, Download, Eye, FileText, GripVertical, Image as ImageIcon, Italic, Loader2, Mail, Minus, Monitor, MousePointer2, MoveVertical, Package, Palette, PanelTop, Plus, Quote, Redo2, Save, Share2, Smartphone, Square, Table2, Ticket, Trash2, Type, Underline, Undo2, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { duplicateEmailBlock, emailBlockLabels, emailDesignSchema, emailDesignText, moveEmailBlock, newEmailBlock, newEmailDesign, removeEmailBlock, renderEmailBlockContent, renderEmailDesign, type EmailBlock, type EmailBlockType, type EmailDesign } from "@/lib/email-design";
import type { Product as MarketingProduct } from "@/lib/types";
import type { LibraryDocument } from "@/lib/documents";
import "./email-design-editor.css";

const palette = [
  { type: "text", label: "Text", icon: Type }, { type: "image", label: "Image", icon: ImageIcon }, { type: "columns", label: "Split", icon: Columns2 }, { type: "button", label: "Button", icon: MousePointer2 },
  { type: "header", label: "Header bar", icon: PanelTop }, { type: "section", label: "Drop shadow", icon: Square }, { type: "divider", label: "Divider", icon: Minus }, { type: "social", label: "Social links", icon: Share2 },
  { type: "spacer", label: "Spacer", icon: MoveVertical }, { type: "product", label: "Product", icon: Package }, { type: "coupon", label: "Coupon", icon: Ticket }, { type: "table", label: "Table", icon: Table2 },
  { type: "quote", label: "Review quote", icon: Quote }, { type: "video", label: "Video", icon: Video }, { type: "html", label: "HTML", icon: Code },
] as const;
const families = ["Arial", "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Times New Roman"] as const;
type History = { past: EmailDesign[]; present: EmailDesign; future: EmailDesign[] };
type Action = { type: "change"; design: EmailDesign } | { type: "undo" } | { type: "redo" };
function historyReducer(state: History, action: Action): History {
  if (action.type === "undo") { const previous = state.past.at(-1); return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state; }
  if (action.type === "redo") { const next = state.future[0]; return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state; }
  if (JSON.stringify(action.design) === JSON.stringify(state.present)) return state;
  return { past: [...state.past.slice(-39), state.present], present: action.design, future: [] };
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return <label className="email-designer-field">{label}<span className="email-designer-color"><input type="color" aria-label={label} value={value === "transparent" ? "#ffffff" : value} onChange={event => onChange(event.target.value)} /><Input key={value} aria-label={`${label} hex value`} defaultValue={value} onBlur={event => { if (/^#[a-f\d]{6}$/i.test(event.target.value)) onChange(event.target.value); else event.target.value = value; }} /></span></label>;
}
function NumberControl({ label, value, min = 0, max = 100, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label className="email-designer-field">{label}<span className="email-designer-number"><Input key={value} type="number" aria-label={label} min={min} max={max} defaultValue={value} onBlur={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, Math.round(next)))); }} /><span>px</span></span></label>;
}

export function EmailDesignEditor({ initial, name, subject, products = [], template, onSave, onApply, onClose }: { initial: EmailDesign; name: string; subject: string; products?: MarketingProduct[]; template?: LibraryDocument | null; onSave: (design: EmailDesign, name: string, existing?: LibraryDocument | null) => Promise<LibraryDocument>; onApply: (design: EmailDesign, template?: LibraryDocument | null) => void; onClose: () => void }) {
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initial, future: [] });
  const design = history.present;
  const [panel, setPanel] = useState<"blocks" | "styles" | "block">("blocks");
  const [tab, setTab] = useState<"basic" | "prebuilt">("basic");
  const [selected, setSelected] = useState<string | null>(null);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState(template?.name || name || "New email template");
  const [savedTemplate, setSavedTemplate] = useState<LibraryDocument | null>(template ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"close" | "clear" | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const current = design.blocks.find(block => block.id === selected);
  const changed = JSON.stringify(design) !== JSON.stringify(initial);
  useEffect(() => {
    if (!changed) return;
    const preventLoss = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [changed]);
  function apply(next: EmailDesign) {
    const result = emailDesignSchema.safeParse(next);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Check the email layout."); return; }
    setError(""); dispatch({ type: "change", design: result.data });
  }
  function changeBlock(values: Partial<EmailBlock>, id = selected) { if (id) apply({ ...design, blocks: design.blocks.map(block => block.id === id ? { ...block, ...values } : block) }); }
  function changeTheme(values: Partial<EmailDesign["theme"]>) {
    const theme = { ...design.theme, ...values };
    const blocks = design.blocks.map(block => ({ ...block, ...(values.fontFamily && block.fontFamily === design.theme.fontFamily ? { fontFamily: values.fontFamily } : {}), ...(values.fontSize && block.fontSize === design.theme.fontSize ? { fontSize: values.fontSize } : {}), ...(values.textColor && block.color === design.theme.textColor ? { color: values.textColor } : {}) }));
    apply({ ...design, theme, blocks });
  }
  function add(type: EmailBlockType, parentId: string | null = null, column = 0, beforeId?: string, shadow = false) {
    const block = newEmailBlock(type, { parentId, column, fontFamily: design.theme.fontFamily, ...(type === "text" ? { fontSize: design.theme.fontSize, color: design.theme.textColor } : {}), ...(shadow ? { shadow: true, background: "#ffffff", radius: 6 } : {}) });
    const blocks = [...design.blocks]; const index = beforeId ? blocks.findIndex(item => item.id === beforeId) : -1; blocks.splice(index < 0 ? blocks.length : index, 0, block);
    apply({ ...design, blocks }); setSelected(block.id); setPanel("block");
  }
  function onDrop(event: DragEvent<HTMLElement>, parentId: string | null, column: number, beforeId?: string) {
    event.preventDefault(); event.stopPropagation();
    try {
      const data = JSON.parse(event.dataTransfer.getData("application/x-filazoo-email-block"));
      if (data.id) { apply(moveEmailBlock(design, data.id, parentId, column, beforeId)); setSelected(data.id); setPanel("block"); }
      else if (palette.some(item => item.type === data.type)) add(data.type, parentId, column, beforeId, data.shadow);
    } catch { setError("Drop a content block from the sidebar."); }
  }
  function duplicate() { if (current) { const result = duplicateEmailBlock(design, current.id); apply(result.design); setSelected(result.id); } }
  function reorder(direction: -1 | 1) {
    if (!current) return;
    const siblings = design.blocks.filter(block => block.parentId === current.parentId && block.column === current.column);
    const index = siblings.findIndex(block => block.id === current.id), target = siblings[index + direction];
    if (!target) return;
    const beforeId = direction < 0 ? target.id : siblings[index + 2]?.id;
    apply(moveEmailBlock(design, current.id, current.parentId, current.column, beforeId));
  }
  async function save(asNew = false) {
    if (!title.trim()) { setError("Enter a template name."); return; }
    if (!emailDesignText(design).trim()) { setError("Add email content before saving a template."); return; }
    setBusy(true); setError("");
    try { setSavedTemplate(await onSave(design, title.trim(), asNew ? null : savedTemplate)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save the template."); }
    finally { setBusy(false); }
  }
  function exportHtml() {
    const url = URL.createObjectURL(new Blob([renderEmailDesign(design).html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${title.replace(/[^a-z0-9]+/gi, "-").slice(0, 80) || "email"}.html`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function upload(file?: File) {
    if (!file || !current) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 750000) { setError("Choose a PNG, JPG, GIF, or WebP image up to 750 KB."); return; }
    const blockId = current.id;
    const reader = new FileReader(); reader.onload = () => changeBlock({ src: String(reader.result), alt: file.name.replace(/\.[^.]+$/, "") }, blockId); reader.onerror = () => setError("Unable to read this image."); reader.readAsDataURL(file);
  }
  function prebuilt(kind: "welcome" | "products" | "newsletter") {
    const base = newEmailDesign();
    if (kind === "welcome") base.blocks.push(newEmailBlock("text", { heading: "", text: "Hello {{first_name}},\n\nWelcome to Filazoo.", fontSize: 18 }), newEmailBlock("button"));
    if (kind === "products") { const columns = newEmailBlock("columns"); base.blocks.push(newEmailBlock("text", { text: "Explore our products", fontSize: 26, bold: true, align: "center" }), columns, newEmailBlock("product", { parentId: columns.id, column: 0 }), newEmailBlock("product", { parentId: columns.id, column: 1 })); }
    if (kind === "newsletter") base.blocks.push(newEmailBlock("text", { text: "Your latest update", fontSize: 28, bold: true }), newEmailBlock("text", { text: "Hello {{first_name}},\n\nShare your latest news here." }), newEmailBlock("divider"), newEmailBlock("text", { text: "Filazoo", fontSize: 12, align: "center" }));
    apply(base); setSelected(null); setPanel("blocks");
  }

  function renderBlocks(parentId: string | null, column = 0) {
    const blocks = design.blocks.filter(block => block.parentId === parentId && block.column === column);
    return <div className="email-designer-dropArea" onDragOver={event => event.preventDefault()} onDrop={event => onDrop(event, parentId, column)}>
      {blocks.map(block => <div key={block.id} role="group" tabIndex={0} aria-label={`${emailBlockLabels[block.type]} block`} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelected(block.id); setPanel("block"); } }} className={`email-designer-block${selected === block.id ? " is-selected" : ""}`} onClick={event => { event.stopPropagation(); event.preventDefault(); setSelected(block.id); setPanel("block"); }} onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => onDrop(event, parentId, column, block.id)}>
        <div className="email-designer-blockBar"><span>{emailBlockLabels[block.type]}</span><button type="button" draggable aria-label={`Drag ${emailBlockLabels[block.type]} block`} onDragStart={event => { event.dataTransfer.setData("application/x-filazoo-email-block", JSON.stringify({ id: block.id })); event.dataTransfer.effectAllowed = "move"; }}><GripVertical /></button><button type="button" aria-label="Duplicate block" onClick={event => { event.stopPropagation(); const result = duplicateEmailBlock(design, block.id); apply(result.design); setSelected(result.id); }}><Copy /></button><button type="button" aria-label="Delete block" onClick={event => { event.stopPropagation(); apply(removeEmailBlock(design, block.id)); setSelected(null); setPanel("blocks"); }}><Trash2 /></button></div>
        <div className="email-designer-blockContent" style={{ padding: block.padding, background: block.background, color: block.color, fontFamily: block.fontFamily, fontSize: block.fontSize, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? "italic" : "normal", textDecoration: block.underline ? "underline" : "none", textAlign: block.align, borderRadius: block.radius, boxShadow: block.shadow ? "0 2px 8px #00000018" : undefined } as CSSProperties}>
          {block.type === "columns" ? <div className="email-designer-columns" style={{ gridTemplateColumns: `repeat(${viewport === "mobile" ? 1 : block.columnCount},minmax(0,1fr))` }}>{Array.from({ length: block.columnCount }, (_, index) => <div key={index}>{renderBlocks(block.id, index)}</div>)}</div> : block.type === "section" ? renderBlocks(block.id) : block.type === "text" ? <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Edit text block" onClick={event => event.stopPropagation()} onBlur={event => { if (event.currentTarget.innerText !== block.text) changeBlock({ text: event.currentTarget.innerText }, block.id); }} style={{ whiteSpace: "pre-wrap", outline: "none", minHeight: 24 }}>{block.text}</div> : ["image", "product", "video"].includes(block.type) && !block.src ? <div className="email-designer-imagePlaceholder"><ImageIcon /><span>{block.type === "product" ? block.heading : block.type === "video" ? "Add video thumbnail" : "Add image"}</span>{block.type === "product" && block.text ? <small>{block.text}</small> : null}</div> : <div dangerouslySetInnerHTML={{ __html: renderEmailBlockContent(block) }} />}
        </div>
      </div>)}
      <div className={`email-designer-dropZone${blocks.length ? " is-small" : ""}`} onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => onDrop(event, parentId, column)}><Plus /><span>Drop content here</span><button type="button" aria-label="Add text here" onClick={() => add("text", parentId, column)}>Add text</button></div>
    </div>;
  }

  return <div className="email-designer"><header className="email-designer-header"><div><Button variant="ghost" size="icon-sm" aria-label="Back to message" disabled={busy} onClick={() => changed ? setConfirm("close") : onClose()}><ArrowLeft /></Button><Input aria-label="Template name" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></div><span>Email message</span><div><DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={busy} />}>Manage template<ChevronDown /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void save()}><Save />{savedTemplate ? "Save template" : "Save as template"}</DropdownMenuItem><DropdownMenuItem onClick={() => void save(true)}><Copy />Save as new template</DropdownMenuItem><DropdownMenuItem onClick={exportHtml}><Download />Export HTML</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setConfirm("clear")}><Trash2 />Clear content</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button variant="outline" size="sm" onClick={() => setPreview(true)}><Eye />Preview</Button><Button size="sm" disabled={busy} onClick={() => onApply(design, savedTemplate)}>{busy ? <Loader2 className="animate-spin" /> : <Check />}Done</Button></div></header>
    {error ? <div className="email-designer-error" role="alert">{error}</div> : null}
    <div className="email-designer-shell"><nav className="email-designer-rail" aria-label="Email editor tools"><Button variant={panel !== "styles" ? "secondary" : "ghost"} size="icon-sm" aria-label="Add content" onClick={() => setPanel("blocks")}><Plus /></Button><Button variant={panel === "styles" ? "secondary" : "ghost"} size="icon-sm" aria-label="Edit styles" onClick={() => setPanel("styles")}><Palette /></Button></nav><aside className="email-designer-sidebar">
      <div className="email-designer-sidebarTitle">{panel === "block" && current ? <><Button size="icon-xs" variant="ghost" aria-label="Back to content blocks" onClick={() => setPanel("blocks")}><ArrowLeft /></Button><strong>Edit {emailBlockLabels[current.type].toLowerCase()}</strong></> : <strong>{panel === "styles" ? "Edit styles" : "Add content"}</strong>}</div>
      <div className="email-designer-sidebarBody">
        {panel === "blocks" || (panel === "block" && !current) ? <><div className="email-designer-paletteTabs"><Button variant={tab === "basic" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("basic")}>Basic</Button><Button variant={tab === "prebuilt" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("prebuilt")}>Pre-built</Button></div>{tab === "basic" ? <><h3>Blocks</h3><div className="email-designer-palette">{palette.map(item => <button key={item.label} type="button" draggable onDragStart={event => { event.dataTransfer.setData("application/x-filazoo-email-block", JSON.stringify({ type: item.type, shadow: item.label === "Drop shadow" })); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => add(item.type, null, 0, undefined, item.label === "Drop shadow")}><item.icon /><span>{item.label}</span></button>)}</div><h3>Layout</h3><div className="email-designer-palette"><button type="button" onClick={() => add("columns")}><Columns2 />Columns</button><button type="button" onClick={() => add("section")}><Square />Section</button></div></> : <div className="email-designer-prebuilt">{[{ id: "welcome", title: "Welcome email", icon: Mail }, { id: "products", title: "Product spotlight", icon: Package }, { id: "newsletter", title: "Newsletter", icon: FileText }].map(item => <button key={item.id} type="button" onClick={() => prebuilt(item.id as "welcome" | "products" | "newsletter")}><item.icon /><strong>{item.title}</strong><span>Use layout</span></button>)}</div>}</> : null}
        {panel === "styles" ? <><ColorControl label="Template background" value={design.theme.background} onChange={background => changeTheme({ background })} /><label className="email-designer-field">Background image<Input placeholder="https://…" value={design.theme.backgroundImage} onChange={event => changeTheme({ backgroundImage: event.target.value })} /></label><ColorControl label="Content background" value={design.theme.contentBackground} onChange={contentBackground => changeTheme({ contentBackground })} /><NumberControl label="Width" value={design.theme.width} min={320} max={900} onChange={width => changeTheme({ width })} /><NumberControl label="Corner radius" value={design.theme.radius} max={40} onChange={radius => changeTheme({ radius })} /><NumberControl label="Margin top" value={design.theme.marginTop} max={120} onChange={marginTop => changeTheme({ marginTop })} /><NumberControl label="Padding" value={design.theme.padding} max={80} onChange={padding => changeTheme({ padding })} /><h3>Text and headings</h3><label className="email-designer-field">Font<select value={design.theme.fontFamily} onChange={event => changeTheme({ fontFamily: event.target.value as EmailDesign["theme"]["fontFamily"] })}>{families.map(font => <option key={font}>{font}</option>)}</select></label><NumberControl label="Font size" value={design.theme.fontSize} min={10} max={32} onChange={fontSize => changeTheme({ fontSize })} /><ColorControl label="Text color" value={design.theme.textColor} onChange={textColor => changeTheme({ textColor })} /></> : null}
        {panel === "block" && current ? <><div className="email-designer-blockActions"><Button size="icon-xs" variant="outline" aria-label="Move block up" onClick={() => reorder(-1)}><ArrowUp /></Button><Button size="icon-xs" variant="outline" aria-label="Move block down" onClick={() => reorder(1)}><ArrowDown /></Button><Button size="icon-xs" variant="outline" aria-label="Duplicate selected block" onClick={duplicate}><Copy /></Button><Button size="icon-xs" variant="outline" aria-label="Delete selected block" onClick={() => { apply(removeEmailBlock(design, current.id)); setSelected(null); setPanel("blocks"); }}><Trash2 /></Button></div>
          {["text", "header", "button", "coupon", "quote", "product", "video"].includes(current.type) ? <label className="email-designer-field">{current.type === "button" ? "Button text" : current.type === "coupon" ? "Coupon code" : "Text"}<Textarea value={current.text} maxLength={12000} rows={5} onChange={event => changeBlock({ text: event.target.value })} /></label> : null}
          {["product", "coupon", "quote"].includes(current.type) ? <label className="email-designer-field">Heading<Input value={current.heading} maxLength={300} onChange={event => changeBlock({ heading: event.target.value })} /></label> : null}
          {current.type === "product" ? <label className="email-designer-field">Product<select value={current.productSku} onChange={event => { const product = products.find(item => item.sku === event.target.value); changeBlock({ productSku: event.target.value, ...(product ? { heading: product.name, text: product.material, src: product.imageUrl ?? "", alt: product.name } : {}) }); }}><option value="">Select product</option>{products.map(product => <option key={product.sku} value={product.sku}>{product.name}</option>)}</select></label> : null}
          {["image", "product", "header", "video"].includes(current.type) ? <><label className="email-designer-field">Image URL<Input placeholder="https://…" value={current.src.startsWith("data:") ? "Uploaded image" : current.src} readOnly={current.src.startsWith("data:")} onChange={event => changeBlock({ src: event.target.value })} /></label><div className="email-designer-imageControls"><Button variant="outline" size="sm" onClick={() => imageInput.current?.click()}><Upload />Upload image</Button>{current.src ? <Button variant="ghost" size="sm" onClick={() => changeBlock({ src: "" })}>Remove</Button> : null}<input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { upload(event.target.files?.[0]); event.target.value = ""; }} /></div><label className="email-designer-field">Alt text<Input value={current.alt} maxLength={300} onChange={event => changeBlock({ alt: event.target.value })} /></label><NumberControl label="Image width" value={current.width} min={20} max={1200} onChange={width => changeBlock({ width })} /></> : null}
          {["image", "button", "product", "video"].includes(current.type) ? <label className="email-designer-field">{current.type === "video" ? "Video URL" : "Link URL"}<Input value={current.href} placeholder="https://…" maxLength={2000} onChange={event => changeBlock({ href: event.target.value })} /></label> : null}
          {["header", "social"].includes(current.type) ? <div className="email-designer-links"><h3>Links</h3>{current.links.map((link, index) => <div key={index}><Input aria-label={`Link ${index + 1} label`} placeholder="Label" value={link.label} onChange={event => changeBlock({ links: current.links.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /><Input aria-label={`Link ${index + 1} URL`} placeholder="https://…" value={link.href} onChange={event => changeBlock({ links: current.links.map((item, i) => i === index ? { ...item, href: event.target.value } : item) })} /><Button variant="ghost" size="icon-xs" aria-label="Remove link" onClick={() => changeBlock({ links: current.links.filter((_, i) => i !== index) })}><Trash2 /></Button></div>)}<Button size="sm" variant="outline" disabled={current.links.length >= 10} onClick={() => changeBlock({ links: [...current.links, { label: "Link", href: "" }] })}><Plus />Add link</Button></div> : null}
          {current.type === "html" ? <label className="email-designer-field">HTML content<Textarea className="email-designer-code" value={current.html} maxLength={30000} rows={14} onChange={event => changeBlock({ html: event.target.value })} /></label> : null}
          {current.type === "table" ? <label className="email-designer-field">Table content<Textarea key={current.id + JSON.stringify(current.rows)} rows={8} defaultValue={current.rows.map(row => row.join(" | ")).join("\n")} onBlur={event => changeBlock({ rows: event.target.value.split("\n").slice(0, 20).map(row => row.split("|").slice(0, 6).map(cell => cell.trim())) })} /><small>One row per line. Separate columns with |.</small></label> : null}
          {current.type === "columns" ? <label className="email-designer-field">Columns<select value={current.columnCount} onChange={event => { const count = Number(event.target.value); apply({ ...design, blocks: design.blocks.map(block => block.id === current.id ? { ...block, columnCount: count } : block.parentId === current.id && block.column >= count ? { ...block, column: count - 1 } : block) }); }}><option value="2">2 columns</option><option value="3">3 columns</option></select></label> : null}
          {["spacer", "divider"].includes(current.type) ? <NumberControl label="Height" value={current.height} min={1} max={400} onChange={height => changeBlock({ height })} /> : null}
          {!['spacer', 'divider', 'columns', 'section'].includes(current.type) ? <><div className="email-designer-format">{[{ key: "bold", icon: Bold }, { key: "italic", icon: Italic }, { key: "underline", icon: Underline }].map(item => <Button key={item.key} size="icon-sm" variant={current[item.key as "bold" | "italic" | "underline"] ? "secondary" : "outline"} aria-label={item.key} onClick={() => changeBlock({ [item.key]: !current[item.key as "bold" | "italic" | "underline"] })}><item.icon /></Button>)}{[{ value: "left", icon: AlignLeft }, { value: "center", icon: AlignCenter }, { value: "right", icon: AlignRight }].map(item => <Button key={item.value} size="icon-sm" variant={current.align === item.value ? "secondary" : "outline"} aria-label={`Align ${item.value}`} onClick={() => changeBlock({ align: item.value as EmailBlock["align"] })}><item.icon /></Button>)}</div><label className="email-designer-field">Font<select value={current.fontFamily} onChange={event => changeBlock({ fontFamily: event.target.value as EmailBlock["fontFamily"] })}>{families.map(font => <option key={font}>{font}</option>)}</select></label><NumberControl label="Font size" value={current.fontSize} min={8} max={64} onChange={fontSize => changeBlock({ fontSize })} /></> : null}
          <ColorControl label={current.type === "divider" ? "Line color" : "Text color"} value={current.color} onChange={color => changeBlock({ color })} /><ColorControl label="Background color" value={current.background} onChange={background => changeBlock({ background })} /><NumberControl label="Padding" value={current.padding} max={80} onChange={padding => changeBlock({ padding })} /><NumberControl label="Corner radius" value={current.radius} max={40} onChange={radius => changeBlock({ radius })} /><label className="email-designer-checkbox"><input type="checkbox" checked={current.shadow} onChange={event => changeBlock({ shadow: event.target.checked })} />Drop shadow</label>
        </> : null}
      </div>
    </aside><main className="email-designer-workspace" style={{ backgroundColor: design.theme.background, backgroundImage: design.theme.backgroundImage && /^https?:\/\//i.test(design.theme.backgroundImage) ? `url(${JSON.stringify(design.theme.backgroundImage)})` : undefined }}>
      <div className="email-designer-canvasToolbar"><Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: "undo" })}><Undo2 /></Button><Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={!history.future.length} onClick={() => dispatch({ type: "redo" })}><Redo2 /></Button><span /><Button size="icon-sm" variant={viewport === "desktop" ? "secondary" : "ghost"} aria-label="Desktop preview" onClick={() => setViewport("desktop")}><Monitor /></Button><Button size="icon-sm" variant={viewport === "mobile" ? "secondary" : "ghost"} aria-label="Mobile preview" onClick={() => setViewport("mobile")}><Smartphone /></Button></div>
      <div className="email-designer-page" lang="en" translate="no" data-no-translate style={{ width: viewport === "mobile" ? 375 : design.theme.width, backgroundColor: design.theme.contentBackground, color: design.theme.textColor, fontFamily: design.theme.fontFamily, fontSize: design.theme.fontSize, borderRadius: design.theme.radius, marginTop: design.theme.marginTop, padding: design.theme.padding }} onClick={() => { setSelected(null); setPanel("blocks"); }}>{renderBlocks(null)}</div>
    </main></div>
    <Dialog open={preview} onOpenChange={setPreview}><DialogContent className="!z-[90] !w-[min(1000px,calc(100vw-32px))] !max-w-none"><DialogHeader><DialogTitle>Email preview</DialogTitle><DialogDescription>{subject || title}</DialogDescription></DialogHeader><div className="email-designer-previewActions"><Button variant={viewport === "desktop" ? "secondary" : "ghost"} size="sm" onClick={() => setViewport("desktop")}><Monitor />Desktop</Button><Button variant={viewport === "mobile" ? "secondary" : "ghost"} size="sm" onClick={() => setViewport("mobile")}><Smartphone />Mobile</Button></div><iframe title="Designed email preview" sandbox="" srcDoc={renderEmailDesign(design).html} className="email-designer-previewFrame" style={{ width: viewport === "mobile" ? "375px" : "100%" }} /></DialogContent></Dialog>
    <Dialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null); }}><DialogContent className="!z-[90]"><DialogHeader><DialogTitle>{confirm === "clear" ? "Clear the email content?" : "Discard editor changes?"}</DialogTitle><DialogDescription>{confirm === "clear" ? "You can restore the content with Undo." : "Choose Done to keep your changes in this campaign."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Keep editing</Button><Button variant="destructive" onClick={() => { if (confirm === "clear") { apply({ ...design, blocks: [] }); setSelected(null); setPanel("blocks"); setConfirm(null); } else onClose(); }}>{confirm === "clear" ? "Clear content" : "Discard changes"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
