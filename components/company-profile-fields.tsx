"use client";

import { useId, useRef, useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Check, Loader2, Pencil, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { updateCompanyFields } from "@/app/crm-actions";
import type { CompanyCommerce } from "@/lib/company-commerce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type InlineFieldName = "name" | "website" | "country" | "city" | "segment" | "contactName" | "contactRole" | "contactEmail" | "summary" | "tags" | "fitScore" | `commerce.${keyof CompanyCommerce}`;

const fieldLimits: Partial<Record<InlineFieldName, number>> = {
  name: 160, website: 500, country: 100, city: 100, contactEmail: 320, summary: 5000, tags: 2000,
  "commerce.phone": 80, "commerce.shippingRecipient": 160, "commerce.shippingPhone": 80,
  "commerce.address": 2000, "commerce.shippingAddress": 2000, "commerce.shippingNotes": 2000,
  "commerce.taxId": 100, "commerce.email": 320,
};

export function CompanyInlineField({ companyId, name, label, value, canWrite, placeholder, hideLabel = false, important = false, className = "", options, suggestedValue }: {
  companyId: string; name: InlineFieldName; label: string; value: string; canWrite: boolean;
  placeholder?: string; hideLabel?: boolean; important?: boolean; className?: string; options?: readonly string[]; suggestedValue?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [confirmed, setConfirmed] = useState<{ source: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const display = confirmed?.source === value ? confirmed.value : value;
  const required = ["name", "country", "segment", "contactEmail", "commerce.currency"].includes(name);
  const multiline = ["summary", "commerce.address", "commerce.shippingAddress", "commerce.shippingNotes"].includes(name);
  const numeric = name === "fitScore" || name === "commerce.termsDays";
  const inputType = numeric ? "number" : name === "contactEmail" || name === "commerce.email" ? "email" : name.toLowerCase().endsWith("phone") ? "tel" : "text";
  const editorProps = {
    autoFocus: true, "aria-labelledby": `${id}-label`, "aria-describedby": error ? `${id}-error` : undefined, "aria-invalid": Boolean(error),
    name, value: draft, disabled: pending, required,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setDraft(event.target.value),
  };

  function close() {
    setEditing(false);
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canWrite) return;
    const next = draft.trim();
    if (next === display) { close(); return; }
    setError("");
    startTransition(async () => {
      try {
        const patch = name.startsWith("commerce.") ? { commerce: { [name.slice("commerce.".length)]: numeric ? Number(next) : next } }
          : name === "fitScore" ? { fitScore: next ? Number(next) : "" } : { [name]: next };
        const result = await updateCompanyFields(companyId, patch);
        if (!result?.success) { setError(result?.error || "The change could not be confirmed. Please retry."); return; }
        setConfirmed({ source: value, value: name === "commerce.termsDays" ? String(Number(next)) : next });
        close();
        toast.success(`${label} saved.`);
      } catch {
        setError("The change could not be saved. Your edit is still here; please retry.");
      }
    });
  }

  return <div className={`company-inline-field ${multiline ? "company-property-multiline" : ""} ${className}`} data-editing={editing || undefined}>
    <span id={`${id}-label`} className={hideLabel ? "sr-only" : "company-property-label"}>{label}{important ? <><span aria-hidden="true" className="company-property-important" title="Important field">✦</span><span className="sr-only"> (important)</span></> : null}</span>
    {editing ? <form onSubmit={save} className="company-inline-editor" aria-label={`Edit ${label}`} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!pending) close(); }
      if (multiline && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!pending) event.currentTarget.requestSubmit(); }
    }}>
      <div className="company-inline-controls">
        {options ? <select {...editorProps} className="company-inline-select">{options.map(option => <option key={option} value={option}>{option}</option>)}</select>
          : multiline ? <Textarea {...editorProps} rows={3} maxLength={fieldLimits[name]} />
          : <Input {...editorProps} type={inputType} inputMode={name === "website" ? "url" : undefined}
            minLength={["name", "country", "segment"].includes(name) ? 2 : undefined} maxLength={numeric ? undefined : fieldLimits[name] ?? 120}
            min={numeric ? name === "fitScore" ? 1 : 0 : undefined} max={numeric ? name === "fitScore" ? 10 : 365 : undefined} step={numeric ? 1 : undefined} />}
        <Button type="submit" variant="ghost" size="icon-xs" disabled={pending} aria-label={`Save ${label}`} title={multiline ? "Save (Ctrl+Enter)" : "Save (Enter)"}>{pending ? <Loader2 className="animate-spin" /> : <Check />}</Button>
        <Button type="button" variant="ghost" size="icon-xs" disabled={pending} aria-label={`Cancel ${label} edit`} title="Cancel (Esc)" onClick={close}><X /></Button>
      </div>
      {suggestedValue ? <button type="button" className="company-inline-suggestion" disabled={pending} onClick={() => setDraft(suggestedValue)}>Use billing address</button> : null}
      {error ? <p id={`${id}-error`} role="alert" className="company-profile-error">{error}</p> : null}
    </form> : canWrite ? <button ref={trigger} type="button" className={`company-property-value ${!display ? "company-property-empty" : ""}`} aria-label={`${display ? "Edit" : "Add"} ${label}`} onClick={() => { setDraft(display); setEditing(true); setError(""); }}>
      <span>{display || placeholder || `+ Add ${label.toLowerCase()}`}</span><Pencil aria-hidden="true" className="company-property-pencil" />
    </button> : <span className="company-property-readonly">{display || "Not added"}</span>}
  </div>;
}

export function CompanyProfileSection({ title, icon: Icon, children }: {
  title: string; icon: LucideIcon; children: ReactNode;
}) {
  const id = useId();
  return <section className="company-profile-section" aria-labelledby={id}>
    <h3 id={id} className="company-overview-heading"><Icon aria-hidden="true" />{title}</h3>
    <div className="company-properties">{children}</div>
  </section>;
}
