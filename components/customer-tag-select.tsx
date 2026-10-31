"use client";

import { useState } from "react";
import { Check, LoaderCircle, Tag } from "lucide-react";
import { CustomerTagBadge, CustomerTagLabel } from "@/components/customer-tag-badges";
import { customerTags, customerTagStyle, type CustomerTag } from "@/lib/customer-tags";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function CustomerTagSelect({ value, onChange, disabled, label = "Conversation tag" }: {
  value: CustomerTag | null; onChange: (tag: CustomerTag | null) => Promise<void>; disabled?: boolean; label?: string;
}) {
  const [saving, setSaving] = useState(false);
  async function change(tag: CustomerTag | null) {
    if (tag === value) return;
    setSaving(true);
    try { await onChange(tag); } finally { setSaving(false); }
  }
  return <DropdownMenu>
    <DropdownMenuTrigger disabled={disabled || saving} aria-label={label} title={value || "Add tag"}
      className={`inline-flex w-fit max-w-full shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${value ? customerTagStyle(value) : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
      {saving ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
      {value ? <CustomerTagLabel tag={value} /> : <><Tag aria-hidden="true" className="size-3.5" />Add tag</>}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-80">
      {customerTags.map(tag => <DropdownMenuItem key={tag.name} onClick={() => void change(tag.name)} title={tag.description} className="justify-between gap-3">
        <CustomerTagBadge tag={tag.name} />{value === tag.name ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      </DropdownMenuItem>)}
      {value ? <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => void change(null)}>Remove tag</DropdownMenuItem></> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}
