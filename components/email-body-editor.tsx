"use client";

import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type Ref, type SetStateAction } from "react";
import { emailTextHtml, initialComposerHtml, sanitizeComposerHtml } from "@/lib/email-composer";
import { appendEmailFooter, withoutComposerFooter, type EmailFooter } from "@/lib/email-footer";
import { imageFileDataUrl, preparePastedEmailHtml } from "@/lib/email-paste";

export function useEmailEditorValue() {
  const [value, setValue] = useState({ text: "", html: "", bodyText: "" });
  const setText = useCallback((next: SetStateAction<string>) => setValue((current) => { const text = typeof next === "function" ? next(current.text) : next; return { text, html: "", bodyText: text }; }), []);
  const onChange = useCallback((text: string, html: string, bodyText = text) => setValue({ text, html, bodyText }), []);
  return { ...value, hasImages: /<img\b/i.test(withoutComposerFooter(value.html)), setText, onChange };
}

export type EmailBodyEditorHandle = {
  focus: () => void; insertText: (text: string) => void; insertImages: (files: File[]) => void;
  format: (command: "bold" | "italic" | "underline" | "insertUnorderedList") => void;
  selectedText: () => string; insertLink: (url: string, text: string) => void;
  currentFooter: () => EmailFooter | null;
};

export function EmailBodyEditor({ value, html, signature, footer, onChange, onError, onBusyChange, attachmentCount, disabled, label, placeholder, className = "", ref }: {
  value: string; html: string; signature: string; footer?: EmailFooter | null;
  onChange: (text: string, html: string, bodyText?: string) => void; onError: (message: string) => void; onBusyChange: (busy: boolean) => void;
  attachmentCount: number; disabled?: boolean; label: string; placeholder: string; className?: string; ref?: Ref<EmailBodyEditorHandle>;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const lastValue = useRef({ text: "", html: "" });
  const lastFooter = useRef<EmailFooter | null | undefined>(undefined);
  const revision = useRef(0);
  const reading = useRef(false);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    if (editor.current && (lastValue.current.text !== value || lastValue.current.html !== html || !editor.current.innerHTML || (lastFooter.current !== footer && !html))) {
      editor.current.innerHTML = html || (footer ? appendEmailFooter(value, undefined, footer).html || initialComposerHtml(value, "") : initialComposerHtml(value, signature));
      lastValue.current = { text: value, html };
      lastFooter.current = footer;
      selection.current = null;
      revision.current++;
    }
  }, [value, html, signature, footer]);
  useLayoutEffect(() => () => { revision.current++; }, []);

  function rememberSelection() {
    const current = window.getSelection();
    if (current?.rangeCount && editor.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange();
  }
  function retainedImageCount() {
    return Array.from(editor.current?.querySelectorAll("img") || []).filter((image) => !selection.current || selection.current.collapsed || !selection.current.intersectsNode(image)).length;
  }
  function publish() {
    if (!editor.current) return;
    const next = { text: editor.current.innerText.replace(/\u00a0/g, " "), html: editor.current.innerHTML || "<div><br></div>" };
    lastValue.current = next;
    function bodyText(node: Node): string {
      if (node.nodeType === 3) return node.textContent || "";
      if (node.nodeType !== 1) return "";
      const element = node as HTMLElement;
      if (element.hasAttribute("data-email-footer")) return "";
      if (element.tagName === "BR") return "\n";
      const content = Array.from(element.childNodes).map(bodyText).join("");
      return /^(DIV|P|LI|TR|BLOCKQUOTE)$/.test(element.tagName) ? `${content}\n` : content;
    }
    onChange(next.text, next.html, Array.from(editor.current.childNodes).map(bodyText).join("").replace(/\u00a0/g, " ").trim());
    rememberSelection();
  }
  function copySelection(event: ClipboardEvent<HTMLDivElement>, cut = false) {
    const current = window.getSelection();
    if (!current?.rangeCount || current.isCollapsed || !editor.current?.contains(current.getRangeAt(0).commonAncestorContainer)) return;
    const fragment = document.createElement("div");
    fragment.append(current.getRangeAt(0).cloneContents());
    event.clipboardData.setData("text/html", sanitizeComposerHtml(fragment.innerHTML, document));
    event.clipboardData.setData("text/plain", current.toString());
    event.preventDefault();
    if (cut && !disabled) { document.execCommand("delete"); publish(); }
  }
  function insertHtml(markup: string, at = selection.current) {
    const root = editor.current;
    if (!root || disabled) return;
    root.focus();
    const range = at && root.contains(at.commonAncestorContainer) ? at : document.createRange();
    if (range !== at) { range.selectNodeContents(root); range.collapse(false); }
    const current = window.getSelection();
    current?.removeAllRanges();
    current?.addRange(range);
    // insertHTML keeps browser undo/redo available for paste and file insertion.
    document.execCommand("insertHTML", false, markup);
    publish();
  }
  useImperativeHandle(ref, () => ({
    focus: () => editor.current?.focus(),
    insertText: (text) => insertHtml(emailTextHtml(text)),
    insertImages: (files) => { void insertFiles(files); },
    selectedText: () => selection.current?.toString() || "",
    currentFooter: () => {
      const section = editor.current?.querySelector<HTMLElement>('[data-email-footer="true"]');
      return section ? { html: section.innerHTML, text: section.innerText.trim() } : footer ? { html: "", text: "" } : null;
    },
    insertLink: (url, text) => { if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) insertHtml(`<a href="${emailTextHtml(url)}">${emailTextHtml(text || url)}</a>`); },
    format: (command) => {
      if (disabled || !editor.current) return;
      editor.current.focus();
      if (selection.current && editor.current.contains(selection.current.commonAncestorContainer)) {
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(selection.current);
      }
      document.execCommand(command); publish();
    },
  }));

  async function insertFiles(files: File[]) {
    if (!files.length || reading.current || disabled) return;
    const operation = revision.current;
    const at = selection.current?.cloneRange();
    reading.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      if (attachmentCount + retainedImageCount() + files.length > 10) throw new Error("An email supports up to 10 images and attachments combined.");
      const images = await Promise.all(files.map(async (file) => {
        const url = await imageFileDataUrl(file);
        return `<img src="${url}" alt="${emailTextHtml(file.name || "Image")}" style="max-width:100%;height:auto"><br>`;
      }));
      if (revision.current === operation) insertHtml(images.join(""), at);
    } catch (error) {
      if (revision.current === operation) onError(error instanceof Error ? error.message : "Unable to insert this image.");
    } finally {
      reading.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function pasteRichHtml(markup: string, files: File[]) {
    const operation = revision.current;
    const at = selection.current?.cloneRange();
    reading.current = true; setBusy(true); onBusyChange(true);
    try {
      const pasted = await preparePastedEmailHtml(markup, document, files);
      if (revision.current !== operation) return;
      if (pasted.html.trim()) insertHtml(pasted.html, at);
      if (pasted.missing) onError("Some images require access to the original email. The text and available images were pasted. Copy the missing images individually or upload their original files.");
    } catch (error) { if (revision.current === operation) onError(error instanceof Error ? error.message : "Unable to paste this signature."); }
    finally { reading.current = false; setBusy(false); onBusyChange(false); }
  }

  return <div ref={editor} role="textbox" aria-label={label} aria-multiline="true" aria-readonly={disabled} aria-busy={busy} contentEditable={!disabled} suppressContentEditableWarning data-placeholder={placeholder} data-empty={!value.trim() && !/<img\b/i.test(html) && (html || (footer ? !footer.html : !signature.trim())) ? "true" : undefined}
      className={`email-body-editor w-full break-words bg-transparent text-sm leading-6 outline-none ${className}`}
      onInput={publish} onKeyUp={rememberSelection} onMouseUp={rememberSelection} onBlur={rememberSelection}
      onCopy={(event) => copySelection(event)} onCut={(event) => copySelection(event, true)}
      onPaste={(event) => {
        event.preventDefault();
        if (disabled || reading.current) return;
        rememberSelection();
        const clipboardHtml = event.clipboardData.getData("text/html");
        let clean = "";
        try { clean = clipboardHtml ? sanitizeComposerHtml(clipboardHtml, document, true) : ""; }
        catch (error) { onError(error instanceof Error ? error.message : "Unable to paste this image."); return; }
        const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        // Prefer HTML image URLs over clipboard PNG snapshots so copied GIFs animate.
        if (files.length && !/<img\b/i.test(clean)) { void insertFiles(files); return; }
        const count = (clean.match(/<img\b/gi) || []).length;
        if (count + attachmentCount + retainedImageCount() > 10) { onError("An email supports up to 10 images and attachments combined."); return; }
        if (/src="https?:|data-email-image-source=/i.test(clean)) { void pasteRichHtml(clean, files); return; }
        insertHtml(clean || emailTextHtml(event.clipboardData.getData("text/plain")));
      }}
      onDragOver={(event) => { event.preventDefault(); }}
      onDrop={(event) => { event.preventDefault(); onError("Paste an image to place it at the cursor."); }} />;
}
