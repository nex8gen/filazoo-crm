"use client";

import { useRef, useState } from "react";
import { Bold, Italic, Underline, List, Link2, ImagePlus, Smile, LoaderCircle } from "lucide-react";
import { EmailBodyEditor, type EmailBodyEditorHandle } from "@/components/email-body-editor";
import { useEmailFooter } from "@/components/use-email-footer";
import { usePreferences } from "@/components/preferences-provider";
import { initialComposerHtml, sanitizeComposerHtml } from "@/lib/email-composer";
import { emailContentSandbox, emailDocument } from "@/lib/email-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { EmailFooter } from "@/lib/email-footer";
import "@/components/email-workspace.css";

export function EmailFooterSettings() {
  const { preferences } = usePreferences();
  const { footer, loading, error: loadError } = useEmailFooter();
  if (loading) return <p role="status" className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading footer…</p>;
  if (loadError) return <p role="alert" className="mt-6 text-sm text-destructive">{loadError}</p>;
  return <EmailFooterEditor initial={footer || { text: preferences.emailSignature, html: initialComposerHtml(preferences.emailSignature, "") }} />;
}

function EmailFooterEditor({ initial }: { initial: EmailFooter }) {
  const [draft, setDraft] = useState<EmailFooter>(initial);
  const [saved, setSaved] = useState(initial.html);
  const savedFooter = useRef(initial);
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const editor = useRef<EmailBodyEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = draft.html !== saved;

  async function save() {
    if (busy || mediaBusy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/email/footer", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: draft.html }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save your email footer.");
      setDraft(result.footer); setSaved(result.footer.html); setNotice("Your email footer is saved.");
      savedFooter.current = result.footer;
      window.dispatchEvent(new CustomEvent("email-footer-updated", { detail: result.footer }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save your email footer."); }
    finally { setBusy(false); }
  }

  return <section className="mt-8 space-y-4 border-t pt-6" aria-labelledby="email-footer-title">
    <div><h3 id="email-footer-title" className="text-sm font-semibold">Custom email footer</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Your personal footer is added to inbox emails, replies, and emails sent by your AI agent. Other users keep their own footers.</p></div>
    <>
      <div className="overflow-hidden rounded-lg border bg-background">
        <div role="toolbar" aria-label="Footer formatting" className="flex flex-wrap gap-1 border-b bg-muted/30 p-2" onMouseDown={(event) => event.preventDefault()}>
          {([{ command: "bold", label: "Bold", Icon: Bold }, { command: "italic", label: "Italic", Icon: Italic }, { command: "underline", label: "Underline", Icon: Underline }, { command: "insertUnorderedList", label: "Bullet list", Icon: List }] as const).map(({ command, label, Icon }) => <button key={command} type="button" title={label} aria-label={label} disabled={busy} onClick={() => editor.current?.format(command)} className="rounded p-2 hover:bg-muted disabled:opacity-40"><Icon className="size-4" /></button>)}
          <button type="button" title="Add link" aria-label="Add link" disabled={busy} onClick={() => { setLinkText(editor.current?.selectedText() || ""); setLinkUrl(""); setLinkOpen(true); }} className="rounded p-2 hover:bg-muted"><Link2 className="size-4" /></button>
          <button type="button" title="Add image or GIF" aria-label="Add image or GIF" disabled={busy || mediaBusy} onClick={() => fileInput.current?.click()} className="rounded p-2 hover:bg-muted">{mediaBusy ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}</button>
          <Popover><PopoverTrigger title="Add icon" aria-label="Add icon" disabled={busy} className="rounded p-2 hover:bg-muted"><Smile className="size-4" /></PopoverTrigger><PopoverContent className="w-64 p-3"><PopoverTitle>Add icon</PopoverTitle><div className="grid grid-cols-6 gap-1">{["☎️", "📱", "✉️", "🌐", "📍", "💬", "🔗", "🏢", "🛒", "✅", "⭐", "👋"].map((icon) => <button type="button" key={icon} aria-label={icon} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.current?.insertText(icon)} className="rounded p-2 text-lg hover:bg-muted">{icon}</button>)}</div></PopoverContent></Popover>
          <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(event) => { editor.current?.insertImages(Array.from(event.target.files || [])); event.target.value = ""; }} />
        </div>
        <EmailBodyEditor ref={editor} value={draft.text} html={draft.html} signature="" onChange={(text, html) => { setDraft({ text, html }); setNotice(""); }} onError={setError} onBusyChange={setMediaBusy} attachmentCount={0} disabled={busy} label="Email footer" placeholder="Your name, title, company, and contact details" className="min-h-48 max-h-96 overflow-y-auto p-4" />
      </div>
      <p className="text-xs text-muted-foreground">Add text, images, icons, links, or GIFs. You can also paste a signature here.</p>
      {draft.html ? <div className="rounded-lg border bg-muted/20 p-4"><p className="mb-3 text-xs font-medium text-muted-foreground">Footer preview</p><iframe title="Footer preview" sandbox={emailContentSandbox} srcDoc={emailDocument(sanitizeComposerHtml(draft.html, document)).replace("</head>", "<style>body{font:14px/24px Arial,sans-serif}p{margin:0}</style></head>")} onLoad={(event) => { const frame = event.currentTarget; frame.style.height = "1px"; frame.style.height = `${Math.max(64, Math.min(1000, frame.contentDocument?.documentElement.scrollHeight || 208))}px`; }} className="h-52 w-full border-0 bg-white" /></div> : null}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || mediaBusy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save footer"}</Button><Button type="button" variant="outline" disabled={busy || !dirty} onClick={() => { setDraft(savedFooter.current); setError(""); setNotice(""); }}>Discard changes</Button><Button type="button" variant="ghost" disabled={busy || !draft.html} onClick={() => setDraft({ text: "", html: "" })}>Clear footer</Button></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
    </>
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>Add link</DialogTitle></DialogHeader><div className="space-y-3"><div className="space-y-1.5"><Label htmlFor="footer-link-text">Link text</Label><Input id="footer-link-text" value={linkText} onChange={(event) => setLinkText(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="footer-link-url">Link address</Label><Input id="footer-link-url" value={linkUrl} placeholder="https://filazoo.com" onChange={(event) => setLinkUrl(event.target.value)} /></div></div><DialogFooter><Button type="button" disabled={!/^(https?:\/\/|mailto:|tel:)/i.test(linkUrl)} onClick={() => { setLinkOpen(false); editor.current?.insertLink(linkUrl.trim(), linkText); }}>Insert link</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
