"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Loaded on demand so dialog focus/overlay code is absent from the initial theme library. */
export function PortalLibraryDialog({ title, description, wide, onClose, children }: { title: string; description: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className={wide ? "ptl-template-dialog" : undefined}>
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    {children}
  </DialogContent></Dialog>;
}
