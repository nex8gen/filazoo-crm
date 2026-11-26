"use client";

import { Copy, Eye, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function PortalThemeMenu({ name, open, onOpenChange, disabled, canWrite, atLimit, live, changed, lastTheme, onPreview, onRename, onDuplicate, onRestore, onRemove }: {
  name: string; open: boolean; onOpenChange: (open: boolean) => void; disabled: boolean; canWrite: boolean; atLimit: boolean; live: boolean; changed: boolean; lastTheme: boolean;
  onPreview: () => void; onRename: () => void; onDuplicate: () => void; onRestore: () => void; onRemove: () => void;
}) {
  function run(action: () => void) { onOpenChange(false); action(); }
  return <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`} disabled={disabled} />}><MoreHorizontal /></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onClick={() => run(onPreview)}><Eye />Preview draft</DropdownMenuItem>
      {canWrite && <>
        <DropdownMenuItem onClick={() => run(onRename)}><Pencil />Rename</DropdownMenuItem>
        <DropdownMenuItem disabled={atLimit} onClick={() => run(onDuplicate)}><Copy />Duplicate draft</DropdownMenuItem>
        {live && changed && <DropdownMenuItem onClick={() => run(onRestore)}><RotateCcw />Restore published version</DropdownMenuItem>}
        {!live && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" disabled={lastTheme} onClick={() => run(onRemove)}><Trash2 />Remove draft</DropdownMenuItem></>}
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
