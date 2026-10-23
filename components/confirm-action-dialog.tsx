"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ConfirmActionDialog({ open, onOpenChange, title, description, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to complete this action. Please retry.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy.current) { setError(""); onOpenChange(value); } }}>
    <DialogContent showCloseButton={!pending}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={pending} onClick={() => void confirm()}>{pending ? "Deleting…" : "Delete"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
