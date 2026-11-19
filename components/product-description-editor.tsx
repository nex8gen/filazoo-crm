"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2, ImageIcon, AlignLeft, AlignCenter, AlignRight, IndentIncrease, IndentDecrease, RemoveFormatting, Code2, Table2 } from "lucide-react";
import { sanitizeProductDescription } from "@/lib/product-content";
import { escapeEmailHtml } from "@/lib/email-markup";
import { validProductImage } from "@/lib/product-images";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const commands: { label: string; command: string; icon: ComponentType<{ className?: string }> }[][] = [
  [{ label: "Bold", command: "bold", icon: Bold }, { label: "Italic", command: "italic", icon: Italic }, { label: "Underline", command: "underline", icon: Underline }],
  [{ label: "Align left", command: "justifyLeft", icon: AlignLeft }, { label: "Align center", command: "justifyCenter", icon: AlignCenter }, { label: "Align right", command: "justifyRight", icon: AlignRight }],
  [{ label: "Bullet list", command: "insertUnorderedList", icon: List }, { label: "Numbered list", command: "insertOrderedList", icon: ListOrdered }, { label: "Decrease indent", command: "outdent", icon: IndentDecrease }, { label: "Increase indent", command: "indent", icon: IndentIncrease }],
];

export function ProductDescriptionEditor({ value, onChange, disabled }: { value: string; onChange: (html: string) => void; disabled: boolean }) {
  const editor = useRef<HTMLDivElement | null>(null);
  const selection = useRef<Range | null>(null);
  const lastHtml = useRef(sanitizeProductDescription(value));
  const [source, setSource] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [textStyle, setTextStyle] = useState("p");
  const [insert, setInsert] = useState<"link" | "image" | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const bindEditor = useCallback((node: HTMLDivElement | null) => { editor.current = node; if (node) node.innerHTML = lastHtml.current; }, []);
  useEffect(() => {
    const html = sanitizeProductDescription(value);
    if (html !== lastHtml.current) { lastHtml.current = html; if (editor.current) editor.current.innerHTML = html; }
  }, [value]);

  function remember() {
    const selected = window.getSelection();
    if (selected?.rangeCount && editor.current?.contains(selected.getRangeAt(0).commonAncestorContainer)) selection.current = selected.getRangeAt(0).cloneRange();
  }
  function publish() {
    if (!editor.current) return;
    lastHtml.current = sanitizeProductDescription(editor.current.innerHTML);
    onChange(lastHtml.current);
    remember();
  }
  function restore() {
    editor.current?.focus();
    if (selection.current && editor.current?.contains(selection.current.commonAncestorContainer)) {
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(selection.current);
    }
  }
  function format(command: string, argument?: string) {
    if (disabled || source) return;
    restore();
    document.execCommand(command, false, argument);
    publish();
  }
  function insertHtml(html: string) {
    restore();
    document.execCommand("insertHTML", false, sanitizeProductDescription(html));
    publish();
  }
  function openInsert(kind: "link" | "image") { remember(); setUrl(""); setUrlError(""); setInsert(kind); }
  function addUrl() {
    const href = url.trim();
    if (insert === "image" ? !href || !validProductImage(href) : !/^(?:https?:\/\/|mailto:)/i.test(href)) { setUrlError("Enter a valid URL."); return; }
    const kind = insert;
    setInsert(null);
    // Close the nested dialog before restoring focus to the editable description.
    window.setTimeout(() => {
      if (!editor.current || disabled) return;
      if (kind === "image") insertHtml(`<img src="${escapeEmailHtml(href)}" alt="">`);
      else if (selection.current?.toString()) format("createLink", href);
      else insertHtml(`<a href="${escapeEmailHtml(href)}">${escapeEmailHtml(href)}</a>`);
    }, 0);
  }

  return <div className="product-description-editor">
    <div className="product-description-toolbar" role="toolbar" aria-label="Description formatting">
      <Select value={textStyle} disabled={disabled || source} onValueChange={value => { if (value) { setTextStyle(value); format("formatBlock", value); } }}><SelectTrigger size="sm" aria-label="Text style"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="p">Paragraph</SelectItem><SelectItem value="h2">Heading</SelectItem><SelectItem value="h3">Subheading</SelectItem><SelectItem value="blockquote">Quote</SelectItem></SelectContent></Select>
      {commands.slice(0, 1).map((group, index) => <div className="product-description-tools" key={index}>{group.map(({ label, command, icon: Icon }) => <Button variant="ghost" size="icon-xs" key={command} type="button" aria-label={label} title={label} disabled={disabled || source} onMouseDown={event => event.preventDefault()} onClick={() => format(command)}><Icon /></Button>)}</div>)}
      <Label className="product-description-color" title="Text color"><span aria-hidden="true">A</span><span className="sr-only">Text color</span><Input type="color" aria-label="Text color" defaultValue="#111111" disabled={disabled || source} onChange={event => format("foreColor", event.target.value)} /></Label>
      <div className="product-description-tools"><Button variant="ghost" size="icon-xs" type="button" aria-label="Insert link" title="Insert link" disabled={disabled || source} onMouseDown={event => event.preventDefault()} onClick={() => openInsert("link")}><Link2 /></Button><Button variant="ghost" size="icon-xs" type="button" aria-label="Insert image" title="Insert image" disabled={disabled || source} onMouseDown={event => event.preventDefault()} onClick={() => openInsert("image")}><ImageIcon /></Button><Button variant="ghost" size="icon-xs" type="button" aria-label="Insert table" title="Insert table" disabled={disabled || source} onMouseDown={event => event.preventDefault()} onClick={() => insertHtml("<table><tbody><tr><th>Heading</th><th>Heading</th></tr><tr><td>Details</td><td>Details</td></tr></tbody></table><p><br></p>")}><Table2 /></Button></div>
      {commands.slice(1).map((group, index) => <div className="product-description-tools" key={index}>{group.map(({ label, command, icon: Icon }) => <Button variant="ghost" size="icon-xs" key={command} type="button" aria-label={label} title={label} disabled={disabled || source} onMouseDown={event => event.preventDefault()} onClick={() => format(command)}><Icon /></Button>)}</div>)}
      <Button variant="ghost" size="icon-xs" type="button" aria-label="Clear formatting" title="Clear formatting" disabled={disabled || source} onMouseDown={event => event.preventDefault()} onClick={() => format("removeFormat")}><RemoveFormatting /></Button>
      <Button variant="ghost" size="icon-xs" type="button" aria-label="Edit HTML source" title="Edit HTML source" aria-pressed={source} disabled={disabled} onClick={() => { if (!source) setSourceDraft(lastHtml.current); setSource(!source); }}><Code2 /></Button>
    </div>
    {source ? <Textarea aria-label="Description HTML source" className="product-description-source" value={sourceDraft} disabled={disabled} onChange={event => { setSourceDraft(event.target.value); const clean = sanitizeProductDescription(event.target.value); lastHtml.current = clean; onChange(clean); }} /> : <div ref={bindEditor} role="textbox" aria-label="Description" aria-multiline="true" aria-readonly={disabled} contentEditable={!disabled} suppressContentEditableWarning className="product-description-content" data-placeholder="Describe your product…" onInput={publish} onKeyUp={remember} onMouseUp={remember} onBlur={remember} onPaste={event => { event.preventDefault(); if (!disabled) insertHtml(event.clipboardData.getData("text/html") || `<p>${escapeEmailHtml(event.clipboardData.getData("text/plain")).replace(/\n/g, "<br>")}</p>`); }} onDrop={event => event.preventDefault()} />}
    <Dialog open={insert !== null} onOpenChange={open => { if (!open) setInsert(null); }}><DialogContent>
      <DialogHeader><DialogTitle>{insert === "image" ? "Insert image" : "Insert link"}</DialogTitle></DialogHeader>
      <div className="space-y-2"><Label htmlFor="description-url">URL</Label><Input id="description-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addUrl(); } }} />{urlError ? <p role="alert" className="text-xs text-destructive">{urlError}</p> : null}</div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setInsert(null)}>Cancel</Button><Button type="button" onClick={addUrl}>Insert</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
