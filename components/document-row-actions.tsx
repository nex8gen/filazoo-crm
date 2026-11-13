"use client";

import { useState } from "react";
import { ArrowDownToLine, ExternalLink, Mail, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { documentSourceHref } from "@/lib/document-connections";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { LibraryDocument } from "@/lib/documents";
import { isBuiltinEmailTemplate } from "@/lib/documents";

export function DocumentRowActions({ document, canWrite, onEmail, onEdit, onTrash, onRestore }: {
  document: LibraryDocument; canWrite: boolean; onEmail: () => void; onEdit: () => void; onTrash: () => void; onRestore: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const sourceHref = documentSourceHref(document);
  const binary = document.mime_type !== "application/x-filazoo-record";
  const builtin = isBuiltinEmailTemplate(document);
  async function download() {
    setBusy(true);
    try {
      let url: string;
      if (document.kind === "template") url = URL.createObjectURL(new Blob([document.subject ? `Subject: ${document.subject}\n\n${document.body}` : document.body], { type: "text/plain;charset=utf-8" }));
      else {
        const response = await fetch(`/api/documents/${document.id}?download=1`); const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        url = result.url;
      }
      const link = window.document.createElement("a"); link.href = url; link.download = document.kind === "template" ? `${document.name}.txt` : document.name; link.rel = "noopener"; link.click();
      if (document.kind === "template") setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to download this file."); }
    finally { setBusy(false); }
  }
  return <DropdownMenu><DropdownMenuTrigger className="library-row-menu" aria-label={`Actions for ${document.name}`} disabled={busy}><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>
    {document.deleted_at ? canWrite ? <DropdownMenuItem onClick={onRestore}><RotateCcw />Restore</DropdownMenuItem> : null : <>
      {sourceHref ? <DropdownMenuItem onClick={() => window.location.assign(sourceHref)}><ExternalLink />Open source record</DropdownMenuItem> : null}
      {canWrite && binary ? <DropdownMenuItem disabled={document.kind === "file" && document.size > 7500000} onClick={onEmail}><Mail />Use in email</DropdownMenuItem> : null}
      {binary ? <DropdownMenuItem onClick={() => void download()}><ArrowDownToLine />Download</DropdownMenuItem> : null}
      {canWrite && builtin ? <DropdownMenuItem onClick={onEdit}><Pencil />Customize a copy</DropdownMenuItem> : null}
      {canWrite && !builtin && !document.source_type ? <><DropdownMenuItem onClick={onEdit}><Pencil />{document.kind === "template" ? "Edit template" : "Edit details / move"}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={onTrash}><Trash2 />Move to trash</DropdownMenuItem></> : null}
    </>}
  </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>;
}
