"use client";

export function EmailDraftStatus({ status, onRetry, disabled = false }: {
  status: string;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const needsRetry = status !== "Draft saved" && !/^(Saving|Loading) drafts?/.test(status);
  return <div className={`flex min-w-0 items-start gap-2 text-xs leading-5 ${needsRetry ? "rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "text-muted-foreground"}`}>
    <span role="status" className="min-w-0 flex-1 break-words">{status}</span>
    {needsRetry ? <button type="button" onClick={onRetry} disabled={disabled} className="shrink-0 rounded px-1 font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40">Retry save</button> : null}
  </div>;
}
