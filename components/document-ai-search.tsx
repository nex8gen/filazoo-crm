"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NotificationToast } from "@/components/ui/notification-toast";
import { DocumentFileIcon } from "@/components/document-file-icon";
import type { LibraryDocument } from "@/lib/documents";
import { useLanguage } from "@/components/language-provider";

export function DocumentAiSearch({ onSelect, kind, disabled = false }: { onSelect: (document: LibraryDocument) => void | Promise<void>; kind?: "file" | "template"; disabled?: boolean }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ documents: LibraryDocument[]; explanation: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [inserting, setInserting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function search() {
    if (loading || disabled || query.trim().length < 3) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/documents/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, ...(kind ? { kind } : {}) }), signal: request.signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Unable to search the library.");
      if (!request.signal.aborted) setResult(value);
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to search the library."); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  return <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
    <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); void search(); }}><Sparkles aria-hidden className="size-4 shrink-0 text-primary" /><Input className="min-w-0 flex-1" aria-label={t("Ask AI to find files or templates")} placeholder={t("Find the latest catalog or a saved email template…")} value={query} maxLength={1000} disabled={disabled || loading || Boolean(inserting)} onChange={event => { setQuery(event.target.value); setResult(null); setError(""); }} /><Button type="submit" size="sm" variant="outline" disabled={disabled || loading || Boolean(inserting) || query.trim().length < 3}>{loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}<span className="hidden sm:inline">{t("Find with AI")}</span><span className="sr-only sm:hidden">{t("Find with AI")}</span></Button></form>
    {error ? <NotificationToast>{t(error)}</NotificationToast> : null}
    {result ? <div className="space-y-2"><div className="flex items-start justify-between gap-2"><p role="status" className="text-xs leading-5 text-muted-foreground">{result.explanation}</p><Button variant="ghost" size="icon-sm" aria-label={t("Clear AI results")} disabled={Boolean(inserting)} onClick={() => setResult(null)}><X className="size-3.5" /></Button></div><ul className="max-h-60 divide-y overflow-y-auto rounded-md border bg-background">{result.documents.map(document => <li key={document.id}><button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted disabled:opacity-50" disabled={Boolean(inserting) || disabled} onClick={async () => { setInserting(document.id); setError(""); try { await onSelect(document); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to insert this item."); } finally { setInserting(null); } }}>{inserting === document.id ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <DocumentFileIcon document={document} size={24} />}<span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{document.name}</span><span className="block truncate text-xs text-muted-foreground">{document.company || t(document.kind === "template" ? "Email template" : "Shared file")}</span></span><span className="text-xs text-primary">{t(document.kind === "template" ? "Insert" : "Attach")}</span></button></li>)}</ul><p className="text-xs text-muted-foreground">{t("Choose a result to insert it. Nothing is sent automatically.")}</p></div> : null}
  </div>;
}
