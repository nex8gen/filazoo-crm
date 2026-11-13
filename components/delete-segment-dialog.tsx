"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useActionState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteSegment, type SegmentActionState } from "@/app/segment-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type DeletableSegment = { id: string; name: string; kind: "saved" | "business" };

export function DeleteSegmentDialog({ segment, onClose }: { segment: DeletableSegment; onClose: () => void }) {
  const [state, action, pending] = useActionState(async (previous: SegmentActionState, formData: FormData) => {
    try {
      const result = await deleteSegment(previous, formData);
      if (result.success) { toast.success(result.success); onClose(); }
      return result;
    } catch { return { error: "Unable to delete the segment. Please try again." }; }
  }, {});

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent showCloseButton={!pending}>
      <DialogHeader>
        <DialogTitle>Delete segment</DialogTitle>
        <DialogDescription>This action cannot be undone.</DialogDescription>
      </DialogHeader>
      <p className="break-words text-sm font-medium" data-no-translate>{segment.name}</p>
      <p className="text-sm text-muted-foreground">{segment.kind === "saved"
        ? "This saved audience and its membership rules will be deleted. Your companies and contacts will be kept."
        : "This business segment label will be cleared from all companies in your workspace that use it. These companies will move to Unclassified. Your companies and contacts will be kept."}</p>
      <p className="text-sm text-muted-foreground">Existing workflows will be kept. Review workflows that use this segment before deleting it.</p>
      <form action={action} className="space-y-4">
        <input type="hidden" name="kind" value={segment.kind} />
        <input type="hidden" name="segmentId" value={segment.kind === "saved" ? segment.id : segment.name} />
        {state.error ? <NotificationToast>{state.error}</NotificationToast> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending} autoFocus>Cancel</Button>
          <Button type="submit" variant="destructive" disabled={pending}>{pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" className="size-4" />}{pending ? "Deleting…" : "Delete segment"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
