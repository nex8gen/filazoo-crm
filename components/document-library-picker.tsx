"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { documentSizeLabel } from "@/lib/document-connections";
import { DocumentFileIcon } from "@/components/document-file-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDocumentSize, type LibraryDocument } from "@/lib/documents";
import { documentLibraryQueryKey } from "@/lib/document-library-state";
import { useDocumentLibrary } from "@/components/use-document-library";

export function DocumentLibraryPicker({ onClose, onSelect, filesOnly = false, initialTab = "templates" }: {
  onClose: () => void; onSelect: (document: LibraryDocument) => Promise<void> | void; filesOnly?: boolean; initialTab?: "files" | "templates";
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState(filesOnly || initialTab === "files" ? "all" : "templates");
  const [selectionError, setSelectionError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const queryKey = documentLibraryQueryKey({ q: query, view: tab, attachable: "1", kind: filesOnly || tab === "all" ? "file" : "template" });
  const { data, error: loadError } = useDocumentLibrary(queryKey);
  const error = selectionError || loadError;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>{filesOnly ? "Choose a related file" : "Files & templates"}</DialogTitle><DialogDescription>{filesOnly ? "Link a file from your library to this template." : "Insert a template or attach a file from your workspace library."}</DialogDescription></DialogHeader>
    <div className="flex h-9 items-center gap-2 rounded-lg border px-3"><Search className="size-4 text-muted-foreground" /><input autoFocus aria-label="Search library items" className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search files, companies, and tags" value={query} onChange={event => { setQuery(event.target.value); setSelectionError(""); }} /></div>
    {!filesOnly ? <div className="flex gap-2"><Button size="sm" variant={tab === "templates" ? "secondary" : "ghost"} onClick={() => { setTab("templates"); setSelectionError(""); }}>Email templates</Button><Button size="sm" variant={tab === "all" ? "secondary" : "ghost"} onClick={() => { setTab("all"); setSelectionError(""); }}>Files</Button></div> : null}
    <div className="min-h-40 max-h-80 overflow-y-auto rounded-lg border divide-y">{data?.documents.map(document => <button disabled={!!busy} type="button" key={document.id} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted disabled:opacity-50" onClick={async () => { setBusy(document.id); setSelectionError(""); try { await onSelect(document); onClose(); } catch (cause) { setSelectionError(cause instanceof Error ? cause.message : "Unable to insert this item."); } finally { setBusy(null); } }}>
      {busy === document.id ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <DocumentFileIcon document={document} size={30} />}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{document.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{[document.company, document.kind === "template" ? "Email template" : documentSizeLabel(document) || formatDocumentSize(document.size), ...document.tags].filter(Boolean).join(" · ")}</span></span><span className="text-xs text-muted-foreground">{filesOnly ? "Link" : document.kind === "template" ? "Insert" : "Attach"}</span>
    </button>)}{!data && !error ? <div className="flex justify-center p-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : !data?.documents.length ? <p className="px-5 py-12 text-center text-sm text-muted-foreground">No matching items. Add files or templates in your library first.</p> : null}</div>
    {data && data.total > data.documents.length ? <p className="text-xs text-muted-foreground">Showing the first {data.documents.length} results. Search to narrow the list.</p> : null}
    {error ? <NotificationToast>{error}</NotificationToast> : null}
  </DialogContent></Dialog>;
}
