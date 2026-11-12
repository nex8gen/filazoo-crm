"use client";

import { useId, useState } from "react";
import { ChevronDown, RefreshCw, Search, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CampaignAudience, CampaignContactOption } from "@/lib/email-campaigns";

export function CampaignAudienceSelect({ label, options, contacts, value, onChange, onRefresh, disabled }: { label: string; options: CampaignAudience[]; contacts: CampaignContactOption[]; value: string[]; onChange: (value: string[]) => void; onRefresh: () => void; disabled: boolean }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"segments" | "contacts">("segments");
  const [limit, setLimit] = useState(50);
  const lookup = new Map([...options, ...contacts].map(item => [item.id, item.name]));
  const names = value.map(key => lookup.get(key) ?? "Unavailable selection");
  const toggle = (key: string, checked: boolean) => onChange(checked ? [...new Set([...value, key])] : value.filter(item => item !== key));
  const search = query.trim().toLowerCase();
  const matchingContacts = contacts.filter(contact => `${contact.name} ${contact.email} ${contact.companyName}`.toLowerCase().includes(search));
  const matchingSegments = options.filter(option => option.name.toLowerCase().includes(search));
  return <div className="campaign-builder-field"><span id={id}>{label}</span><Popover><PopoverTrigger disabled={disabled} aria-labelledby={id} className="campaign-builder-select"><span>{names.length ? names.join(", ") : "Select segments or contacts"}</span><ChevronDown /></PopoverTrigger><PopoverContent align="start" className="!w-[min(460px,calc(100vw-32px))] !gap-2 !p-2">
    <div className="campaign-audience-search"><Search /><Input autoFocus aria-label={`Search ${label.toLowerCase()}`} placeholder="Search segments, names, or email addresses" value={query} onChange={event => { setQuery(event.target.value); setLimit(50); }} /></div>
    <div className="campaign-audience-tabs"><Button size="sm" variant={tab === "segments" ? "secondary" : "ghost"} onClick={() => setTab("segments")}><Users />Segments <span>{options.length}</span></Button><Button size="sm" variant={tab === "contacts" ? "secondary" : "ghost"} onClick={() => setTab("contacts")}><UserRound />Contacts <span>{contacts.length}</span></Button><Button size="icon-xs" variant="ghost" aria-label="Refresh audiences and contacts" onClick={onRefresh}><RefreshCw /></Button></div>
    <div className="campaign-builder-audiences campaign-audience-options">
      {tab === "segments" ? [{ kind: "all", title: "All contacts" }, { kind: "saved", title: "Saved segments" }, { kind: "business", title: "Business segments" }].map(group => {
        const items = matchingSegments.filter(option => (option.kind ?? (option.id === "all" ? "all" : "saved")) === group.kind);
        return items.length ? <div key={group.kind}><p className="campaign-audience-group">{group.title}</p>{items.map(option => <label className="campaign-audience-option" key={option.id}><input type="checkbox" checked={value.includes(option.id)} onChange={event => toggle(option.id, event.target.checked)} /><span data-no-translate>{option.name}</span><small>{option.count}</small></label>)}</div> : null;
      }) : matchingContacts.slice(0, limit).map(contact => <label className="campaign-audience-option" key={contact.id}><input type="checkbox" checked={value.includes(contact.id)} onChange={event => toggle(contact.id, event.target.checked)} /><span data-no-translate>{contact.name}<small>{contact.email}{contact.companyName ? ` · ${contact.companyName}` : ""}</small></span><small className={contact.eligible ? "text-primary" : ""}>{contact.eligible ? contact.verificationStatus === "valid" ? "Verified" : "Submitted" : "Review needed"}</small></label>)}
      {tab === "contacts" && matchingContacts.length > limit ? <Button size="sm" variant="ghost" className="w-full" onClick={() => setLimit(value => value + 50)}>Load more contacts</Button> : null}
      {(tab === "segments" ? !matchingSegments.length : !matchingContacts.length) ? <p className="campaign-audience-empty">No matching segments or contacts</p> : null}
    </div><div className="campaign-audience-note">{value.length} selected<span>Counts show all contacts; send eligibility is checked separately.</span></div>
  </PopoverContent></Popover></div>;
}
