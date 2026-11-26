"use client";

import { useEffect, useState } from "react";
import { Check, FileText, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ChatLibraryFile } from "@/lib/ai/file-input-library-client";

export default function AiLibraryPicker({ remaining, onClose, onAdd }: { remaining: number; onClose: () => void; onAdd: (files: ChatLibraryFile[]) => Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [files, setFiles] = useState<ChatLibraryFile[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<ChatLibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ kind: "file", attachable: "1", q: query, offset: String(offset) });
        const response = await fetch(`/api/documents?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load your library.");
        if (!controller.signal.aborted) { setFiles(result.documents); setTotal(result.total); setError(null); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load your library.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, offset]);
  const page = (next: number) => { setLoading(true); setOffset(next); };
  return <Dialog open onOpenChange={open => { if (!open && !adding) onClose(); }}>
    <DialogContent className="z-[90] sm:max-w-lg" overlayClassName="z-[80]" aria-describedby={undefined} showCloseButton={!adding}>
      <DialogHeader><DialogTitle>Add from library</DialogTitle></DialogHeader>
      <label className="flex items-center gap-2 rounded-lg border px-3 py-2"><Search aria-hidden="true" className="size-4 text-muted-foreground" /><span className="sr-only">Search library files</span><input value={query} onChange={event => { setLoading(true); setOffset(0); setQuery(event.target.value); }} placeholder="Search files" disabled={adding} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <div className="max-h-80 min-h-40 overflow-y-auto" aria-busy={loading}>
        {loading ? <div role="status" className="grid min-h-40 place-items-center"><Loader2 aria-label="Loading files" className="size-5 animate-spin text-muted-foreground" /></div> : error ? <p role="alert" className="p-3 text-sm text-destructive">{error}</p> : files.length ? files.map(file => {
          const checked = selected.some(item => item.id === file.id);
          return <button type="button" key={file.id} role="checkbox" aria-checked={checked} disabled={adding || (!checked && selected.length >= remaining)} onClick={() => setSelected(current => checked ? current.filter(item => item.id !== file.id) : [...current, file])} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted disabled:opacity-50">
            <FileText aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1"><span data-no-translate className="block truncate text-sm">{file.name}</span>{file.company ? <span data-no-translate className="block truncate text-xs text-muted-foreground">{file.company}</span> : null}</span>
            <span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>{checked ? <Check className="size-3" /> : null}</span>
          </button>;
        }) : <p className="p-3 text-sm text-muted-foreground">{query ? "No matching files." : "Your library has no files yet."}</p>}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={loading || adding || offset === 0} onClick={() => page(Math.max(0, offset - 60))}>Previous</Button><Button variant="ghost" size="sm" disabled={loading || adding || offset + files.length >= total} onClick={() => page(offset + 60)}>Next</Button></div>
        <Button disabled={!selected.length || adding} onClick={async () => { setAdding(true); try { if (await onAdd(selected)) onClose(); } finally { setAdding(false); } }}>{adding ? <Loader2 className="size-4 animate-spin" /> : null}Add{selected.length ? ` (${selected.length})` : ""}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
