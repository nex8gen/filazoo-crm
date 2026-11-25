"use client";

import { LoaderCircle, X } from "lucide-react";

/** Progress and recoverable errors belong beside the draft they describe. */
export function EmailReplyStatus({ progress, error, onCancel, onRetry, onDismiss }: {
  progress: string | null;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (!progress && !error) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      {progress ? <LoaderCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" /> : null}
      <p role={error ? "alert" : "status"} className={`min-w-0 flex-1 break-words leading-5 ${error ? "text-destructive" : "text-muted-foreground"}`}>{error || progress}</p>
      {progress ? <button type="button" onClick={onCancel} className="shrink-0 rounded px-1 py-0.5 font-medium hover:bg-muted">Cancel</button> : <>
        <button type="button" onClick={onRetry} className="shrink-0 rounded px-1 py-0.5 font-medium hover:bg-muted">Try again</button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss reply error" className="shrink-0 rounded p-1 hover:bg-muted"><X aria-hidden="true" className="size-3.5" /></button>
      </>}
    </div>
  );
}
