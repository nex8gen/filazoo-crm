"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Forward, Paperclip, Printer, Reply, ReplyAll, Star } from "lucide-react";
import type { EmailWorkspaceItem } from "@/components/email-inbox";
import { emailContentSandbox, emailDocument, splitQuotedEmail, splitQuotedEmailHtml, isInlineEmailAttachment, plainEmailContentHtml, resolveEmailContentIds } from "@/lib/email-content";

function RichEmail({ html, remote }: { html: string; remote: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const document = frame.current?.contentDocument;
    if (!document?.body) return;
    const resize = () => setHeight(Math.max(40, Math.min(30000, Math.ceil(document.body.getBoundingClientRect().height))));
    const observer = new ResizeObserver(resize);
    observer.observe(document.body);
    document.addEventListener("load", resize, true);
    resize();
    return () => { observer.disconnect(); document.removeEventListener("load", resize, true); };
  }, [html, remote, generation]);
  return <iframe ref={frame} title="Email message content" sandbox={emailContentSandbox} srcDoc={emailDocument(html, remote)} onLoad={() => setGeneration((value) => value + 1)} style={{ height }} className="w-full border-0 bg-white" />;
}

function PlainEmail({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-7">{text.split(/(https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g).map((part, index) => /^https?:\/\//i.test(part) || /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(part) ? <a key={index} href={part.includes("://") ? part : `mailto:${part}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">{part}</a> : part)}</div>;
}

export function EmailReaderMessage({ email, expanded, starred, loading, error, onToggle, onLoad, onReply, onForward, onStar, onEditDraft }: {
  email: EmailWorkspaceItem; expanded: boolean; starred: boolean; loading: boolean; error?: string;
  onToggle: () => void; onLoad: () => void; onReply: (all: boolean) => void; onForward: () => void; onStar: () => void;
  onEditDraft?: () => void;
}) {
  const [remote, setRemote] = useState(false);
  const [quotes, setQuotes] = useState(false);
  const html = useMemo(() => email.html ? resolveEmailContentIds(email.html, email.attachments || []) : plainEmailContentHtml(email.body, email.attachments || []), [email.html, email.body, email.attachments]);
  const split = useMemo(() => html ? splitQuotedEmailHtml(html) : splitQuotedEmail(email.body), [html, email.body]);
  const files = email.attachments?.filter((attachment) => !isInlineEmailAttachment(attachment, html)) || [];
  const embedded = email.attachments?.filter((attachment) => isInlineEmailAttachment(attachment, html)) || [];
  const [downloadError, setDownloadError] = useState("");
  const name = email.direction === "outbound" ? email.from || "You" : email.contactName || email.contact;
  const date = new Date(email.timestamp);
  const originalParams = email.uid && email.mailboxKey ? new URLSearchParams({ mailbox: email.mailboxKey, uid: String(email.uid), validity: String(email.uidValidity), folder: email.providerFolder || "INBOX" }) : null;
  async function downloadAll() {
    setDownloadError("");
    try {
      for (const file of files) {
        if (!file.url) throw new Error(`${file.filename} is unavailable.`);
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`Unable to download ${file.filename}.`);
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a"); link.href = url; link.download = file.filename; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (reason) { setDownloadError(reason instanceof Error ? reason.message : "Download failed."); }
  }
  return <article className="border-b py-4" data-email-message={email.id}>
    <div className="flex items-start gap-3">
      <div aria-hidden="true" className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{name.slice(0, 1).toUpperCase()}</div>
      <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} message from ${name}`} onClick={onToggle} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{expanded ? email.direction === "outbound" ? `To ${(email.to || [{ address: email.contact }]).map((item) => item.address).join(", ")}` : email.contact : email.preview || email.subject}</span>
      </button>
      <time dateTime={email.timestamp} title={date.toLocaleString()} className="shrink-0 text-xs text-muted-foreground">{date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
      {files.length ? <Paperclip aria-label={`${files.length} attachments`} className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      <button type="button" aria-label={`${starred ? "Unstar" : "Star"} message from ${name}`} onClick={onStar} className="text-muted-foreground"><Star className="size-4" fill={starred ? "currentColor" : "none"} /></button>
    </div>
    {expanded ? <div className="ml-11 mt-3 min-w-0">
      <details className="mb-4 text-xs text-muted-foreground"><summary className="flex cursor-pointer items-center gap-1">Message details <ChevronDown className="size-3" /></summary><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all rounded-md border bg-muted/20 p-3">
        <dt>From</dt><dd>{email.from || email.contact}</dd>
        {email.to?.length ? <><dt>To</dt><dd>{email.to.map((item) => item.name ? `${item.name} <${item.address}>` : item.address).join(", ")}</dd></> : null}
        {email.cc?.length ? <><dt>Cc</dt><dd>{email.cc.map((item) => item.address).join(", ")}</dd></> : null}
        {email.direction === "outbound" && email.bcc?.length ? <><dt>Bcc</dt><dd>{email.bcc.map((item) => item.address).join(", ")}</dd></> : null}
        {email.replyTo ? <><dt>Reply-To</dt><dd>{email.replyTo}</dd></> : null}
        <dt>Date</dt><dd>{date.toLocaleString()}</dd><dt>Subject</dt><dd>{email.subject}</dd>
      </dl></details>
      {email.bodyLoaded === false ? <div className="py-6 text-sm text-muted-foreground">{loading ? "Loading message…" : <button type="button" onClick={onLoad} className="rounded-md border px-3 py-2">{error || "Load message"}</button>}</div> : <>
        {html && /(?:src\s*=\s*["']https?:|url\(\s*["']?https?:)/i.test(html) ? <div className="mb-3 flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><span>{remote ? "External images are displayed." : "External images are hidden."}</span><button type="button" className="font-medium underline" onClick={() => setRemote((value) => !value)}>{remote ? "Hide images" : "Show images"}</button></div> : null}
        <div data-no-translate>{html ? <RichEmail html={quotes ? html : split.current} remote={remote} /> : <PlainEmail text={quotes ? email.body : split.current} />}</div>
        {split.quoted ? <button type="button" onClick={() => setQuotes((value) => !value)} aria-expanded={quotes} className="mt-3 rounded bg-muted px-2 py-0.5 text-xs" title={quotes ? "Hide quoted history" : "Show quoted history"}>{quotes ? "Hide quoted history" : "•••"}</button> : null}
      </>}
      {files.length ? <section aria-label="Message attachments" className="mt-5 border-t pt-3"><div className="mb-3 flex items-center justify-between text-xs"><span>{files.length} attachment{files.length === 1 ? "" : "s"}</span>{files.length > 1 ? <button type="button" onClick={() => void downloadAll()} className="inline-flex items-center gap-1 underline"><Download className="size-3" />Download all</button> : null}</div><div className="flex flex-wrap gap-2">{files.map((file, index) => <a key={index} href={file.url} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-2 rounded-lg border px-3 py-3 text-xs hover:bg-muted"><Paperclip className="size-4" /><span className="truncate">{file.filename}</span><span className="text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB</span></a>)}</div>{downloadError ? <p role="alert" className="mt-2 text-xs text-red-600">{downloadError}</p> : null}</section> : null}
      {embedded.length ? <details className="mt-4 text-xs text-muted-foreground"><summary className="cursor-pointer">Embedded images and files ({embedded.length})</summary><div className="mt-2 flex flex-wrap gap-2">{embedded.map((file, index) => <a key={index} href={file.url?.startsWith("/api/email/") ? `${file.url}${file.url.includes("?") ? "&" : "?"}download=1` : file.url} download={file.filename} className="inline-flex max-w-full items-center gap-2 rounded border px-3 py-2 hover:bg-muted"><Download className="size-3 shrink-0" /><span className="truncate">{file.filename}</span></a>)}</div></details> : null}
      <div className="mt-5 flex flex-wrap gap-2 text-xs">
        {email.providerKind === "drafts" ? <button type="button" onClick={onEditDraft} className="inline-flex items-center gap-2 rounded-full border px-4 py-2">Edit draft</button> : null}
        <button type="button" onClick={() => onReply(false)} className="inline-flex items-center gap-2 rounded-full border px-4 py-2"><Reply className="size-3.5" />Reply</button>
        <button type="button" onClick={() => onReply(true)} className="inline-flex items-center gap-2 rounded-full border px-4 py-2"><ReplyAll className="size-3.5" />Reply all</button>
        <button type="button" onClick={onForward} className="inline-flex items-center gap-2 rounded-full border px-4 py-2"><Forward className="size-3.5" />Forward</button>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-full border px-3 py-2" aria-label="Print conversation"><Printer className="size-3.5" /></button>
        {originalParams || email.crmEmailId ? <a href={email.crmEmailId ? `/api/email/crm-message?id=${encodeURIComponent(email.crmEmailId)}&format=original` : `/api/email/original?${originalParams}`} className="inline-flex items-center gap-1 rounded-full border px-3 py-2"><Download className="size-3.5" />Original</a> : null}
      </div>
    </div> : null}
  </article>;
}
