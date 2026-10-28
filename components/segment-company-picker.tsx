"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SegmentCompany } from "@/lib/segments";

export function SegmentCompanyPicker({ companies, selectedIds, onChange }: { companies: SegmentCompany[]; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const selected = new Set(selectedIds);
  const visible = companies.filter((company) => `${company.name} ${company.country} ${company.segment}`.toLowerCase().includes(query.trim().toLowerCase()));
  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  }
  return <div className="space-y-3">
    <p className="text-xs leading-5 text-muted-foreground">Choose the companies to include. Your selection stays fixed until you edit this segment.</p>
    <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="Search companies to select" placeholder="Search by company, country or segment" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" /></div>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground" aria-live="polite">{selectedIds.length} selected</p><div className="flex gap-2"><Button type="button" size="sm" variant="ghost" disabled={!visible.length} onClick={() => onChange([...new Set([...selectedIds, ...visible.map((company) => company.id)])])}>Select results</Button><Button type="button" size="sm" variant="ghost" disabled={!selectedIds.length} onClick={() => onChange([])}>Clear selection</Button></div></div>
    <div className="max-h-64 overflow-y-auto rounded-md border" aria-label="Company selection">
      {visible.map((company) => <label key={company.id} className="flex cursor-pointer items-start gap-3 border-b p-3 last:border-b-0 hover:bg-muted/40"><input type="checkbox" checked={selected.has(company.id)} onChange={() => toggle(company.id)} aria-label={company.name} className="mt-0.5 size-4 shrink-0 accent-primary" /><span className="min-w-0"><span data-no-translate className="block truncate text-sm font-medium">{company.name}</span><span className="block truncate text-xs text-muted-foreground">{company.country} · {company.segment}</span></span></label>)}
      {!visible.length ? <p className="p-5 text-center text-xs text-muted-foreground">No companies match your search.</p> : null}
    </div>
  </div>;
}
