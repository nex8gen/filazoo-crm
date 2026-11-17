"use client";

import "./flow-text-email-editor.css";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Image as ImageIcon, Italic, Languages, Link as LinkIcon, List, ListOrdered, MoreVertical, Plus, Redo2, Smile, Strikethrough, Underline, Undo2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmailBodyEditor, type EmailBodyEditorHandle } from "@/components/email-body-editor";
import { flowTextEmailDraft, applyFlowTextEmail, textEmailFonts, type FlowTextEmailDraft } from "@/lib/flow-text-email";
import { emailDesignSchema, emailDesignText, newEmailDesign, renderEmailDesign, type EmailDesign } from "@/lib/email-design";
import { emailTextHtml } from "@/lib/email-markup";
import { flowEditorEqual } from "@/lib/flow-editor-session";
import { renderFlowTemplate } from "@/lib/flow-templates";
import { prepareEmailTranslation } from "@/lib/email-translation-document";
import { requestEmailTranslation } from "@/lib/email-translation-client";
import type { JsonConfig } from "@/lib/flows";

const sample = "Hi {{first_name}},\n\nThis is an email just for you. We hope you like it.\n\nThe Team";
function protectVariables(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parts = node.data.split(/(\{\{[^}]+\}\})/g); if (parts.length === 1) continue;
    const fragment = doc.createDocumentFragment();
    for (const part of parts) {
      if (part.startsWith("{{") && part.endsWith("}}")) { const token = doc.createElement("span"); token.setAttribute("translate", "no"); token.textContent = part; fragment.append(token); }
      else fragment.append(doc.createTextNode(part));
    }
    node.replaceWith(fragment);
  }
  return doc.body.innerHTML;
}

export function FlowTextEmailEditor({ config, name, createNew = false, disabled, onSave, onClose }: { config: JsonConfig; name: string; createNew?: boolean; disabled: boolean; onSave: (config: JsonConfig) => void | Promise<boolean | void>; onClose: () => void }) {
  const [initial] = useState<FlowTextEmailDraft>(() => createNew ? { ...flowTextEmailDraft(config), body: sample, html: emailTextHtml(sample), font: "Arial", fontSize: 14 } : flowTextEmailDraft(config));
  const [draft, setDraft] = useState(initial);
  const [fontSizeText, setFontSizeText] = useState(String(initial.fontSize));
  const editor = useRef<EmailBodyEditorHandle>(null);
  const request = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [insert, setInsert] = useState<"link" | "image" | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [insertError, setInsertError] = useState("");
  const locked = disabled || busy || translating || saving;
  const changed = !flowEditorEqual(initial, draft);
  const update = (change: Partial<FlowTextEmailDraft>) => { if (!locked) { setDraft(current => ({ ...current, ...change })); setError(""); } };
  const close = () => { if (saving) return; if (changed) setConfirmClose(true); else onClose(); };
  useEffect(() => () => request.current?.abort(), []);
  function prepare() {
    if (!draft.body.trim()) { setError("Add some text to your email."); return null; }
    if (draft.body.length > 20000) { setError("Keep the email text under 20,000 characters."); return null; }
    const next = applyFlowTextEmail(config, draft);
    const validation = emailDesignSchema.safeParse(next.emailDesign);
    if (!validation.success) { setError("The email content is too large. Use image links or shorten the message."); return null; }
    return next;
  }
  async function save() {
    if (locked) return;
    const next = prepare(); if (!next) return;
    setSaving(true); setError("");
    try { if (await onSave(next) === false) setError("The message could not be saved. Your edits are still here; try Save again."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The message could not be saved. Please try again."); }
    finally { setSaving(false); }
  }
  async function translate() {
    if (locked || !draft.body.trim()) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setTranslating(true); setError("");
    try {
      const plan = prepareEmailTranslation(draft.body, protectVariables(draft.html));
      if (!plan.segments.length) return;
      const segments = await requestEmailTranslation(plan.segments, (input, init) => fetch(input, { ...init, signal: controller.signal }));
      if (controller.signal.aborted) return;
      const translated = plan.apply(segments);
      const doc = new DOMParser().parseFromString(translated.html || emailTextHtml(translated.body), "text/html");
      const html = doc.body.innerHTML;
      setDraft(current => ({ ...current, html, body: emailDesignText(newEmailDesign(html, "html")) }));
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to translate the email."); }
    finally { if (!controller.signal.aborted) setTranslating(false); }
  }
  function insertContent() {
    if (locked) return;
    let target: URL;
    try { target = new URL(url); } catch { setInsertError("Enter a complete URL."); return; }
    if (insert === "image" ? !["https:", "http:"].includes(target.protocol) : !["https:", "http:", "mailto:", "tel:"].includes(target.protocol)) { setInsertError("Use an https:// or http:// URL."); return; }
    const mode = insert, href = target.toString(), text = label || (mode === "link" ? editor.current?.selectedText() || href : "");
    setInsert(null);
    window.requestAnimationFrame(() => { if (mode === "image") editor.current?.insertImage(href, text); else editor.current?.insertLink(href, text); });
  }
  const previewHtml = preview ? renderEmailDesign(applyFlowTextEmail(config, draft).emailDesign as EmailDesign, { preview: true, personalize: value => renderFlowTemplate(value, { name: "Alex", email: "alex@example.com" }), preheader: draft.noPreview ? undefined : draft.preheader }).html : "";
  const tool = (command: Parameters<EmailBodyEditorHandle["format"]>[0], label: string, icon: React.ReactNode) => <Button type="button" variant="ghost" size="icon-sm" title={label} aria-label={label} disabled={locked} onMouseDown={event => event.preventDefault()} onClick={() => editor.current?.format(command)}>{icon}</Button>;

  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent showCloseButton={false} aria-describedby={undefined} className="wf-text-email-editor !max-w-none">
    <header className="wf-text-email-header"><div><Button variant="ghost" size="sm" disabled={saving} onClick={close}>{name}</Button><span aria-hidden="true">/</span><DialogTitle>Message Content</DialogTitle></div><div><DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={locked || !draft.body.trim()}><Languages />{translating ? "Translating…" : "Translate"}</Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void translate()}>Translate to Simplified Chinese</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button variant="outline" size="sm" disabled={busy || translating || saving} onClick={() => { if (prepare()) setPreview(true); }}>Preview email</Button><Button size="sm" disabled={locked} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button></div></header>
    <main className="wf-text-email-main"><section className="wf-text-email-preheader"><label htmlFor="flow-text-preheader">Preview text</label><Input id="flow-text-preheader" aria-label="Preview text" maxLength={300} value={draft.preheader} disabled={locked || draft.noPreview} onChange={event => update({ preheader: event.target.value })} /><label className="wf-text-email-checkbox"><Checkbox checked={draft.noPreview} disabled={locked} onCheckedChange={value => update({ noPreview: value === true })} />Show no preview text</label></section>
      <section className="wf-text-email-compose"><h2>Email</h2><div className="wf-text-email-type-controls"><select aria-label="Text style" defaultValue="div" disabled={locked} onChange={event => editor.current?.format("formatBlock", event.target.value)}><option value="div">Body</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="blockquote">Quote</option></select><select aria-label="Font family" value={draft.font} disabled={locked} onChange={event => update({ font: event.target.value })}>{textEmailFonts.map(font => <option key={font}>{font}</option>)}</select><label><Input type="number" aria-label="Font size" min={10} max={72} value={fontSizeText} disabled={locked} onChange={event => { const value = event.target.value; setFontSizeText(value); const size = Number(value); if (Number.isInteger(size) && size >= 10 && size <= 72) update({ fontSize: size }); }} onBlur={() => { const size = Math.max(10, Math.min(72, Math.round(Number(fontSizeText)) || draft.fontSize)); update({ fontSize: size }); setFontSizeText(String(size)); }} /><span>px</span></label></div>
        <div className="wf-text-email-formatting" role="toolbar" aria-label="Message formatting">{tool("bold", "Bold", <Bold />)}{tool("italic", "Italic", <Italic />)}{tool("underline", "Underline", <Underline />)}{tool("strikeThrough", "Strikethrough", <Strikethrough />)}<DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More formatting" disabled={locked}><MoreVertical /></Button>} /><DropdownMenuContent><DropdownMenuItem onClick={() => editor.current?.format("insertUnorderedList")}><List />Bullet list</DropdownMenuItem><DropdownMenuItem onClick={() => editor.current?.format("insertOrderedList")}><ListOrdered />Numbered list</DropdownMenuItem></DropdownMenuContent></DropdownMenu><span className="wf-text-email-divider" /><label className="wf-text-email-color" title="Text color"><span aria-hidden="true">A</span><input type="color" aria-label="Text color" defaultValue="#202124" disabled={locked} onChange={event => editor.current?.format("foreColor", event.target.value)} /></label><label className="wf-text-email-color is-highlight" title="Highlight color"><span aria-hidden="true">A</span><input type="color" aria-label="Highlight color" defaultValue="#fff3a3" disabled={locked} onChange={event => editor.current?.format("hiliteColor", event.target.value)} /></label><span className="wf-text-email-divider" /><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Text alignment" disabled={locked}><AlignLeft /></Button>} /><DropdownMenuContent><DropdownMenuItem onClick={() => editor.current?.format("justifyLeft")}><AlignLeft />Align left</DropdownMenuItem><DropdownMenuItem onClick={() => editor.current?.format("justifyCenter")}><AlignCenter />Align center</DropdownMenuItem><DropdownMenuItem onClick={() => editor.current?.format("justifyRight")}><AlignRight />Align right</DropdownMenuItem></DropdownMenuContent></DropdownMenu><span className="wf-text-email-divider" /><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Insert emoji" disabled={locked}><Smile /></Button>} /><DropdownMenuContent>{["😊", "👋", "✨", "🎉", "📦", "💙"].map(emoji => <DropdownMenuItem key={emoji} onClick={() => editor.current?.insertText(emoji)}>{emoji}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu><Button variant="ghost" size="icon-sm" aria-label="Insert image" disabled={locked} onClick={() => { setInsert("image"); setUrl(""); setLabel(""); setInsertError(""); }}><ImageIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Insert link" disabled={locked} onClick={() => { setInsert("link"); setUrl(""); setLabel(editor.current?.selectedText() || ""); setInsertError(""); }}><LinkIcon /></Button>{tool("undo", "Undo", <Undo2 />)}{tool("redo", "Redo", <Redo2 />)}<Button variant="ghost" size="icon-sm" aria-label="Insert first name" disabled={locked} onMouseDown={event => event.preventDefault()} onClick={() => editor.current?.insertText("{{first_name}} ")}><UserRound /></Button><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={locked}><Plus />Insert<ChevronDown /></Button>} /><DropdownMenuContent><DropdownMenuItem onClick={() => editor.current?.insertText("{{first_name}}")}>First name</DropdownMenuItem><DropdownMenuItem onClick={() => editor.current?.format("insertUnorderedList")}>Bullet list</DropdownMenuItem><DropdownMenuItem onClick={() => editor.current?.format("insertOrderedList")}>Numbered list</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
        <div className="wf-text-email-canvas" style={{ "--text-email-font": draft.font, "--text-email-size": `${draft.fontSize}px` } as CSSProperties}><EmailBodyEditor ref={editor} value={draft.body} html={draft.html} signature="" label="Email message content" placeholder="Write your email…" attachmentCount={0} disabled={locked} onError={setError} onBusyChange={setBusy} onChange={(body, html) => { if (!disabled && !translating) { setDraft(current => ({ ...current, body, html })); setError(""); } }} /></div>
      </section>{error ? <p className="wf-text-email-error" role="alert">{error}</p> : null}
    </main>
    <Dialog open={preview} onOpenChange={setPreview}><DialogContent className="wf-text-email-preview !max-w-[min(900px,calc(100%-2rem))]"><DialogHeader><DialogTitle>Preview email</DialogTitle><DialogDescription>{String(config.subject || "Message preview")} · Sample recipient: Alex</DialogDescription></DialogHeader><iframe title="Text only email preview" sandbox="allow-same-origin" srcDoc={previewHtml} /></DialogContent></Dialog>
    <Dialog open={insert !== null} onOpenChange={open => { if (!open) setInsert(null); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{insert === "image" ? "Insert image" : "Insert link"}</DialogTitle><DialogDescription>{insert === "image" ? "Use a publicly accessible image URL." : "Add a link to the selected text."}</DialogDescription></DialogHeader><label className="grid gap-2 text-sm">URL<Input autoFocus value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" /></label><label className="grid gap-2 text-sm">{insert === "image" ? "Alternative text" : "Link text"}<Input value={label} onChange={event => setLabel(event.target.value)} /></label>{insertError ? <p role="alert" className="wf-text-email-error">{insertError}</p> : null}<DialogFooter><Button variant="outline" onClick={() => setInsert(null)}>Cancel</Button><Button onClick={insertContent}>Insert</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={confirmClose} onOpenChange={setConfirmClose}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Discard message changes?</DialogTitle><DialogDescription>Save the message to keep your edits.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmClose(false)}>Keep editing</Button><Button variant="destructive" onClick={() => { request.current?.abort(); onClose(); }}>Discard changes</Button></DialogFooter></DialogContent></Dialog>
  </DialogContent></Dialog>;
}
