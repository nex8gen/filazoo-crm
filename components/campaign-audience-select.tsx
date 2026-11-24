"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, RefreshCw, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignAudience, CampaignContactOption } from "@/lib/email-campaigns";

const pageSize = 50;
const segmentKind = (option: CampaignAudience) => option.kind ?? (option.id === "all" ? "all" : option.id.startsWith("business:") ? "business" : "saved");
type SearchResult = { type: "segment"; item: CampaignAudience; rank: number } | { type: "contact"; item: CampaignContactOption; rank: number };

function matchRank(fields: string[], search: string) {
  return Math.min(...fields.map((field, priority) => {
    const text = field.toLowerCase();
    const index = text.indexOf(search);
    if (index < 0) return Infinity;
    const rank = text === search ? 0 : index === 0 ? 1 : /[\s@._+\-()]/u.test(text[index - 1]) ? 2 : 3;
    return rank * 10 + priority;
  }));
}

function HighlightMatch({ text, search }: { text: string; search: string }) {
  if (!search) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let start = 0;
  for (let index = lower.indexOf(search); index >= 0; index = lower.indexOf(search, start)) {
    parts.push(text.slice(start, index), <mark className="campaign-audience-match" key={index}>{text.slice(index, index + search.length)}</mark>);
    start = index + search.length;
  }
  parts.push(text.slice(start));
  return parts;
}

export function CampaignAudienceSelect({ label, options, contacts, value, onChange, onRefresh, disabled }: { label: string; options: CampaignAudience[]; contacts: CampaignContactOption[]; value: string[]; onChange: (value: string[]) => void; onRefresh: () => void; disabled: boolean }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"segments" | "contacts">("segments");
  const [kind, setKind] = useState("all");
  const [contactAudience, setContactAudience] = useState("");
  const [page, setPage] = useState(1);
  const lookup = new Map([...options, ...contacts].map(item => [item.id, item.name]));
  const chipLabels = new Map([...options.map(item => [item.id, item.name] as const), ...contacts.map(item => [item.id, item.email || item.name] as const)]);
  const search = query.trim().toLowerCase();
  const segments = options.filter(option => segmentKind(option) !== "all");
  const matchingContacts = contacts.filter(contact => !contactAudience || contact.audienceIds?.includes(contactAudience));
  const matchingSegments = options.filter(option => kind === "all" || segmentKind(option) === kind);
  const searchResults: SearchResult[] = search ? [
    ...options.map(item => ({ type: "segment" as const, item, rank: matchRank([item.name], search) })),
    ...contacts.map(item => ({ type: "contact" as const, item, rank: matchRank([item.name, item.email, item.companyName], search) })),
  ].filter(result => Number.isFinite(result.rank)).sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name) || a.item.id.localeCompare(b.item.id)) : [];
  const resultCount = search ? searchResults.length : matchingContacts.length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(resultCount / pageSize)));
  const start = (currentPage - 1) * pageSize;
  const visibleContacts = matchingContacts.slice(start, start + pageSize);
  const visibleResults = searchResults.slice(start, start + pageSize);
  const visibleIds = search ? visibleResults.map(result => result.item.id) : (tab === "segments" ? matchingSegments : visibleContacts).map(item => item.id);
  const viewContacts = (audienceId: string) => { setContactAudience(audienceId === "all" ? "" : audienceId); setQuery(""); setPage(1); setTab("contacts"); };
  const highlight = (text: string) => <HighlightMatch text={text} search={search} />;
  const check = (key: string) => <span className="campaign-audience-check" aria-hidden="true">{value.includes(key) ? <Check /> : null}</span>;
  const renderSegment = (option: CampaignAudience) => <div className="campaign-audience-row" key={option.id}>
    <Combobox.Item value={option.id} className="campaign-audience-option">{check(option.id)}<span data-no-translate>{highlight(option.name)}<small>{search ? segmentKind(option) === "business" ? "Business segment" : segmentKind(option) === "saved" ? "Saved segment" : "All contacts" : null}{search && option.companyCount !== undefined ? " · " : null}{option.companyCount !== undefined ? `${option.companyCount} ${option.companyCount === 1 ? "company" : "companies"}` : null}</small></span><small title="Unique email addresses">{option.count} {option.count === 1 ? "contact" : "contacts"}</small></Combobox.Item>
    <Button size="icon-xs" variant="ghost" aria-label={`View contacts in ${option.name}`} title="View contacts" onClick={() => viewContacts(option.id)}><Users /></Button>
  </div>;
  const renderContact = (contact: CampaignContactOption) => <div className="campaign-audience-contact" key={contact.id}>
    <Combobox.Item value={contact.id} className="campaign-audience-option">{check(contact.id)}<span data-no-translate>{highlight(contact.name)}<small>{highlight(contact.email || "No email address")}{contact.companyName ? <> · {highlight(contact.companyName)}</> : null}</small></span><small className={contact.eligible ? "text-primary" : ""} title={contact.eligibilityReason}>{contact.eligibilityStatus ?? (contact.eligible ? contact.verificationStatus === "valid" ? "Verified" : "Submitted" : "Unverified email")}</small></Combobox.Item>
    {!contact.eligible && contact.eligibilityReason ? <p className="campaign-audience-reason">{contact.eligibilityReason}</p> : null}
  </div>;

  return <div className="campaign-builder-field"><label htmlFor={id}>{label}</label><Combobox.Root<string, true> multiple value={value} onValueChange={(next, details) => {
      if (details.reason === "escape-key") { details.cancel(); return; }
      onChange(next);
      if (details.reason === "item-press") { setQuery(""); setPage(1); inputRef.current?.focus({ preventScroll: true }); }
    }} items={visibleIds} filter={null} itemToStringLabel={key => lookup.get(key) ?? key} disabled={disabled} open={open}
    onOpenChange={(next, details) => { if (!next && details.reason === "item-press") { details.cancel(); return; } setOpen(next); if (next) onRefresh(); else { setQuery(""); setPage(1); } }}
    inputValue={query} onInputValueChange={(next, details) => { if (details.reason === "input-change" || details.reason === "input-clear") { setQuery(next); setPage(1); } }}>
    <Combobox.InputGroup className="campaign-audience-input">
      <Combobox.Chips className="campaign-audience-chips" aria-label={`Selected ${label.toLowerCase()}`}>
        {value.map(key => {
          const name = chipLabels.get(key) ?? "Unavailable selection";
          return <Combobox.Chip key={key} className="campaign-audience-chip" role="group" aria-label={name} title={name} onClick={event => event.currentTarget.focus()}><span data-no-translate>{name}</span><Combobox.ChipRemove aria-label={`Remove ${name}`}><X /></Combobox.ChipRemove></Combobox.Chip>;
        })}
        <Combobox.Input ref={inputRef} id={id} aria-label={label} autoComplete="off" placeholder={value.length ? "Search more segments or contacts" : open ? "Search segments, names, or email addresses" : "Select segments or contacts"}
          onKeyDown={event => {
            if (!disabled && !query && value.length && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
              event.preventDefault();
              onChange(value.slice(0, -1));
            }
          }} />
      </Combobox.Chips>
      <Combobox.Trigger aria-label={`Show ${label.toLowerCase()} options`}><ChevronDown /></Combobox.Trigger>
    </Combobox.InputGroup>
    <Combobox.Portal><Combobox.Positioner align="start" sideOffset={4} className="z-50 outline-none"><Combobox.Popup initialFocus={false} className="campaign-audience-popover flex w-(--anchor-width) max-w-[calc(100vw-32px)] flex-col gap-2 rounded-lg bg-popover p-2 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden">
    {!search ? <>
      <div className="campaign-audience-tabs"><Button size="sm" variant={tab === "segments" ? "secondary" : "ghost"} aria-pressed={tab === "segments"} onClick={() => { setTab("segments"); setPage(1); }}><Users />Segments <span>{segments.length}</span></Button><Button size="sm" variant={tab === "contacts" ? "secondary" : "ghost"} aria-pressed={tab === "contacts"} onClick={() => { setTab("contacts"); setPage(1); }}><UserRound />Contacts <span>{contacts.length}</span></Button><Button size="icon-xs" variant="ghost" aria-label="Refresh audiences and contacts" onClick={onRefresh}><RefreshCw /></Button></div>
      {tab === "segments" ? <div className="campaign-audience-filters" role="group" aria-label="Segment type">{[{ id: "all", name: "All", count: segments.length }, { id: "saved", name: "Saved", count: segments.filter(option => segmentKind(option) === "saved").length }, { id: "business", name: "Business", count: segments.filter(option => segmentKind(option) === "business").length }].map(filter => <Button key={filter.id} size="sm" variant={kind === filter.id ? "secondary" : "ghost"} aria-pressed={kind === filter.id} onClick={() => setKind(filter.id)}>{filter.name} <span>{filter.count}</span></Button>)}</div> : <select aria-label="Filter contacts by segment" className="campaign-builder-select" value={contactAudience} onChange={event => { setContactAudience(event.target.value); setPage(1); }}><option value="">All contacts</option>{segments.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>}
    </> : null}
    <Combobox.List data-search={Boolean(search)} className="campaign-builder-audiences campaign-audience-options" key={`${tab}:${kind}:${contactAudience}:${query}:${currentPage}`}>
      {search ? visibleResults.map(result => result.type === "segment" ? renderSegment(result.item) : renderContact(result.item)) : tab === "segments" ? [{ kind: "all", title: "All contacts" }, { kind: "saved", title: "Saved segments" }, { kind: "business", title: "Business segments" }].map(group => {
        const items = matchingSegments.filter(option => segmentKind(option) === group.kind);
        return items.length ? <div key={group.kind}><p className="campaign-audience-group">{group.title}</p>{items.map(renderSegment)}</div> : null;
      }) : visibleContacts.map(renderContact)}
      {(search ? !searchResults.length : tab === "segments" ? !matchingSegments.length : !matchingContacts.length) ? <p className="campaign-audience-empty">No matching segments or contacts</p> : null}
    </Combobox.List>
    {(search ? resultCount > pageSize : tab === "contacts") ? <div className="campaign-audience-pagination"><span role="status">{resultCount ? start + 1 : 0}–{Math.min(start + pageSize, resultCount)} of {resultCount} {search ? "matches" : "contacts"}</span><Button size="sm" variant="ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={start + pageSize >= resultCount} onClick={() => setPage(currentPage + 1)}>Next</Button></div> : null}
  </Combobox.Popup></Combobox.Positioner></Combobox.Portal></Combobox.Root></div>;
}
