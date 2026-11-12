"use client";

import { useState } from "react";
import { FolderOpen, Paperclip, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

/** Shared attachment entry point for new messages and replies in every mailbox. */
export function EmailAttachmentMenu({ disabled = false, compact = false, onUpload, onLibrary }: {
  disabled?: boolean; compact?: boolean; onUpload: () => void; onLibrary: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger disabled={disabled} title="Attach files" aria-label="Attach files" className={compact
      ? "flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
      : "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"}>
      <Paperclip className="size-4 shrink-0" />{compact ? null : "Attach files"}
    </PopoverTrigger>
    <PopoverContent align="start" side="top" className="w-72 max-w-[calc(100vw-2rem)] gap-1 p-1.5">
      <PopoverTitle className="px-2.5 py-2 text-xs text-muted-foreground">Attach files</PopoverTitle>
      <button type="button" onClick={() => { setOpen(false); onUpload(); }} className="flex w-full items-start gap-3 rounded-md px-2.5 py-2.5 text-left hover:bg-muted">
        <Upload className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span><span className="block text-[13px] font-medium leading-5">Upload from computer</span><span className="mt-0.5 block text-xs leading-4 text-muted-foreground">Choose files from your device</span></span>
      </button>
      <button type="button" onClick={() => { setOpen(false); onLibrary(); }} className="flex w-full items-start gap-3 rounded-md px-2.5 py-2.5 text-left hover:bg-muted">
        <FolderOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span><span className="block text-[13px] font-medium leading-5">Files &amp; templates</span><span className="mt-0.5 block text-xs leading-4 text-muted-foreground">Use saved workspace files or templates</span></span>
      </button>
      <p className="border-t px-2.5 pb-1.5 pt-2 text-xs text-muted-foreground">Up to 10 attachments · 7.5 MB per file</p>
    </PopoverContent>
  </Popover>;
}
