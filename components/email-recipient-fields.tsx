"use client";

import { useId, useState, type ReactNode } from "react";
export function EmailRecipientFields({ to, cc, bcc, onTo, onCc, onBcc, disabled = false, prefix = "", sender }: {
  to: string; cc: string; bcc: string; onTo: (value: string) => void; onCc: (value: string) => void; onBcc: (value: string) => void; disabled?: boolean; prefix?: string; sender?: ReactNode;
}) {
  const [copies, setCopies] = useState(Boolean(cc || bcc));
  const copiesId = useId();
  const showCopies = copies || Boolean(cc || bcc);
  return <div className="mail-recipient-fields text-sm">
    <div className={sender ? "mail-recipient-top" : undefined}>
    {sender}
    <div className="mail-recipient-row flex items-center gap-2 border-b py-2">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="mail-recipient-label w-12 shrink-0 text-xs text-muted-foreground">To</span>
        <input type="text" inputMode="email" autoCapitalize="none" spellCheck={false} aria-label={`${prefix}To recipients`} value={to} onChange={(event) => onTo(event.target.value)} disabled={disabled} placeholder="Add recipients" className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none" />
      </label>
      <button type="button" disabled={disabled} aria-expanded={showCopies} aria-controls={copiesId} onClick={() => setCopies((value) => !value)} className="shrink-0 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40">Cc / Bcc</button>
    </div>
    </div>
    <div id={copiesId} hidden={!showCopies}>
      {([["Cc", cc, onCc], ["Bcc", bcc, onBcc]] as const).map(([label, value, onChange]) => <label key={label} className="mail-recipient-row flex items-center gap-2 border-b py-2"><span className="mail-recipient-label w-12 shrink-0 text-xs text-muted-foreground">{label}</span><input type="text" inputMode="email" autoCapitalize="none" spellCheck={false} aria-label={`${prefix}${label} recipients`} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} placeholder={`${label} recipients`} className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none" /></label>)}
    </div>
  </div>;
}
