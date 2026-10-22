"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  Download,
  Eye,
  Filter,
  Flag,
  Inbox,
  PencilLine,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TablePagination } from "@/components/ui/table-pagination";

export type EmailStatusKey = "draft" | "needs_approval" | "scheduled" | "sent" | "failed";

export type EmailRowData = {
  id: string;
  subject: string;
  contact: string;
  company: string;
  sequence: string;
  step: string;
  owner: string;
  status: string;
  statusKey: EmailStatusKey;
  scheduledFor: string;
  updatedAt: string;
  preview: string;
  body: string;
  lastOrder: string;
  pastEmails: string[];
  openDeals: string[];
  notes: string;
  checks: { label: string; ok: boolean }[];
};

const tabConfig: Array<{ key: EmailStatusKey; label: string; tone: string; iconClass: string; countLabel: string }> = [
  { key: "draft", label: "Draft", tone: "text-slate-500", iconClass: "bg-slate-200 text-slate-700", countLabel: "drafts" },
  { key: "needs_approval", label: "Needs approval", tone: "text-amber-600", iconClass: "bg-amber-100 text-amber-700", countLabel: "pending" },
  { key: "scheduled", label: "Scheduled", tone: "text-blue-600", iconClass: "bg-blue-100 text-blue-700", countLabel: "scheduled" },
  { key: "sent", label: "Sent", tone: "text-emerald-600", iconClass: "bg-emerald-100 text-emerald-700", countLabel: "sent" },
  { key: "failed", label: "Failed", tone: "text-red-600", iconClass: "bg-red-100 text-red-700", countLabel: "failed" },
];

function normalizeStatus(value: string): EmailStatusKey {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("approval") || normalized.includes("pending")) return "needs_approval";
  if (normalized.includes("schedule") || normalized.includes("approved")) return "scheduled";
  if (normalized.includes("sent")) return "sent";
  if (normalized.includes("fail")) return "failed";
  return "draft";
}

function toEmailRow(email: Partial<EmailRowData> & { id: string; subject: string; contact?: string; company?: string; sequence?: string; step?: string; owner?: string; status?: string; scheduledFor?: string; updatedAt?: string; preview?: string; body?: string; }): EmailRowData {
  const statusValue = email.status ?? "Draft";
  const statusKey = normalizeStatus(statusValue);
  return {
    id: email.id,
    subject: email.subject,
    contact: email.contact ?? "Unknown contact",
    company: email.company ?? "Unknown company",
    sequence: email.sequence ?? "Intro sequence",
    step: email.step ?? "Step 1 of 3",
    owner: email.owner ?? "Ava R.",
    status: statusValue,
    statusKey,
    scheduledFor: email.scheduledFor ?? "Not scheduled",
    updatedAt: email.updatedAt ?? "Today, 09:14",
    preview: email.preview ?? "No preview available.",
    body: email.body ?? email.preview ?? "No email body available.",
    lastOrder: "PETG 2.85mm • 1,200 kg",
    pastEmails: ["Follow-up on PETG pricing", "Sample pack offered on May 12"],
    openDeals: ["2 active deals", "Quote #FI-2041"],
    notes: "Prefers technical detail and MOQ clarity.",
    checks: [
      { label: "Missing merge fields", ok: false },
      { label: "Unsubscribe link present", ok: true },
      { label: "Contact not suppressed", ok: true },
      { label: "No recent email", ok: true },
    ],
  };
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[24rem] flex-col items-center justify-center gap-4 border border-dashed border-border bg-muted/20 text-center">
      <div className="grid size-12 place-items-center rounded-xl border bg-background">
        <Inbox className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function EmailTableSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-10 animate-pulse rounded-lg bg-muted" />
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/70" />
      ))}
    </div>
  );
}

function EmailTabBar({ activeTab, onChange, countByTab }: { activeTab: EmailStatusKey; onChange: (tab: EmailStatusKey) => void; countByTab: Record<EmailStatusKey, number> }) {
  return (
    <div className="flex flex-wrap items-end gap-2 border-b pb-4">
      {tabConfig.map((tab) => {
        const isActive = tab.key === activeTab;
        const count = countByTab[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`min-w-[10.5rem] rounded-xl border px-3 py-2 text-left transition-colors ${isActive ? "border-border bg-background shadow-sm" : "border-transparent bg-muted/40 text-muted-foreground"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`grid size-5 place-items-center rounded-md ${tab.iconClass}`}><Flag className="size-3.5" /></span>
              <span className="text-sm font-medium">{tab.label}</span>
            </div>
            <div className={`mt-1 text-xs ${isActive ? "text-foreground/70" : "text-muted-foreground"}`}>
              {count} {tab.countLabel}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EmailToolbar({
  filterLabel,
  onFilterChange,
  searchValue,
  onSearchChange,
  selectedCount,
}: {
  filterLabel: string;
  onFilterChange: (value: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  selectedCount: number;
}) {
  return (
    <div className="flex flex-col gap-3 border-b pb-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative min-w-[10rem] flex-1 xl:max-w-[11rem]">
          <select
            aria-label="Filter emails"
            value={filterLabel}
            onChange={(event) => onFilterChange(event.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 pr-8 text-sm text-foreground outline-none focus-visible:border-ring"
          >
            <option value="All">Filter</option>
            <option value="Owner">Owner</option>
            <option value="Sequence">Sequence</option>
            <option value="Company">Company</option>
            <option value="Material">Material</option>
            <option value="Date range">Date range</option>
          </select>
          <Filter className="pointer-events-none absolute right-2 top-2 size-3.5 text-muted-foreground" />
        </div>
        <div className="relative flex-1 xl:max-w-[18rem]">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
          <Input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search subject, company, contact" className="h-8 rounded-lg pl-8" />
        </div>
      </div>

      <div className="flex items-center gap-2 self-end xl:self-auto">
        <Button variant="outline" size="sm" className="gap-2">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="size-3.5" />
          Export CSV
        </Button>
      </div>

      {selectedCount > 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 xl:ml-4">
          <span className="text-xs font-medium text-foreground">{selectedCount} selected</span>
          <Button variant="outline" size="xs">Approve</Button>
          <Button variant="outline" size="xs">Schedule</Button>
          <Button variant="outline" size="xs">Assign owner</Button>
          <Button variant="ghost" size="xs" className="text-destructive">Delete</Button>
        </div>
      ) : null}
    </div>
  );
}

function EmailTable({ rows, selectedIds, onToggleRow, onOpenRow, onSort }: { rows: EmailRowData[]; selectedIds: Set<string>; onToggleRow: (id: string) => void; onOpenRow: (row: EmailRowData) => void; onSort: (field: "updatedAt" | "scheduledFor" | "subject") => void; }) {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="crm-table-frame crm-table-page-wide overflow-hidden border-y border-border bg-background">
      <div className="crm-table-viewport">
        <table className="crm-table min-w-[980px] w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2.5 text-center"><input type="checkbox" aria-label="Select all emails" className="h-3.5 w-3.5 rounded border" /></th>
              <th className="px-3 py-2.5 font-medium"><button type="button" onClick={() => onSort("subject")} className="inline-flex items-center gap-1">Subject <ArrowUpDown className="size-3" /></button></th>
              <th className="px-3 py-2.5 font-medium">Contact and company</th>
              <th className="px-3 py-2.5 font-medium">Sequence and step</th>
              <th className="px-3 py-2.5 font-medium">Owner</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium"><button type="button" onClick={() => onSort("scheduledFor")} className="inline-flex items-center gap-1">Scheduled for <ArrowUpDown className="size-3" /></button></th>
              <th className="px-3 py-2.5 font-medium"><button type="button" onClick={() => onSort("updatedAt")} className="inline-flex items-center gap-1">Last updated <ArrowUpDown className="size-3" /></button></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className="border-b border-border/80 hover:bg-muted/20" onClick={() => onOpenRow(row)}>
                <td className="px-3 py-2 text-center" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => onToggleRow(row.id)} className="h-3.5 w-3.5 rounded border" aria-label={`Select ${row.subject}`} />
                </td>
                <td className="px-3 py-2 text-sm font-medium text-foreground">{row.subject}</td>
                <td className="px-3 py-2 text-sm">
                  <div className="font-medium text-foreground">{row.contact}</div>
                  <div className="text-xs text-muted-foreground">{row.company}</div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{row.sequence}</div>
                  <div>{row.step}</div>
                </td>
                <td className="px-3 py-2 text-sm text-foreground">{row.owner}</td>
                <td className="px-3 py-2">
                  <Badge variant={row.statusKey === "needs_approval" ? "secondary" : row.statusKey === "failed" ? "destructive" : row.statusKey === "sent" ? "default" : "outline"} className={row.statusKey === "scheduled" ? "bg-blue-100 text-blue-700 border-blue-200" : row.statusKey === "needs_approval" ? "bg-amber-100 text-amber-700 border-amber-200" : row.statusKey === "failed" ? "bg-red-100 text-red-700 border-red-200" : row.statusKey === "sent" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-700 border-slate-200"}>
                    {row.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-sm text-muted-foreground">{row.scheduledFor}</td>
                <td className="px-3 py-2 text-sm text-muted-foreground">{row.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination page={currentPage} pageCount={pageCount} start={(currentPage - 1) * pageSize + 1} end={Math.min(currentPage * pageSize, rows.length)} total={rows.length} itemLabel="emails" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
    </div>
  );
}

function EmailDetailDrawer({ row, open, onClose }: { row: EmailRowData | null; open: boolean; onClose: () => void }) {
  const [draftSubject, setDraftSubject] = useState(row?.subject ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [preview, setPreview] = useState(false);

  if (!open || !row) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-[1px]" aria-modal="true" role="dialog">
      <div className="flex h-full w-full max-w-[34rem] flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Sequence review</p>
            <h3 className="mt-1 text-lg font-semibold">{row.company}</h3>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md hover:bg-muted" aria-label="Close drawer">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Subject</label>
              <input value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Message</label>
                <button type="button" onClick={() => setPreview((current) => !current)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground">
                  {preview ? <PencilLine className="size-3" /> : <Eye className="size-3" />}
                  {preview ? "Edit" : "Preview"}
                </button>
              </div>

              {preview ? (
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm leading-6 text-foreground">
                  <p className="mb-3 font-medium">{draftSubject}</p>
                  <p className="whitespace-pre-line">{body}</p>
                </div>
              ) : (
                <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={10} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:border-ring" />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Merge fields</p>
              <div className="flex flex-wrap gap-2">
                {[
                  "name",
                  "company",
                  "last order",
                  "preferred material",
                ].map((field) => (
                  <button
                    key={field}
                    type="button"
                    onClick={() => setBody((current) => `${current}${current.trim() ? " " : ""}{{${field}}}`)}
                    className="rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    {field}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Account context</p>
              </div>
              <div className="grid gap-2 text-sm">
                <div><span className="text-muted-foreground">Last order:</span> <span className="font-medium">{row.lastOrder}</span></div>
                <div><span className="text-muted-foreground">Past emails:</span> <ul className="mt-1 list-disc pl-5 text-foreground">{row.pastEmails.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><span className="text-muted-foreground">Open deals:</span> <ul className="mt-1 list-disc pl-5 text-foreground">{row.openDeals.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><span className="text-muted-foreground">Notes:</span> <span className="font-medium">{row.notes}</span></div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Pre-send checks</p>
              <ul className="mt-3 space-y-2 text-sm">
                {row.checks.map((check) => (
                  <li key={check.label} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-2.5 py-2">
                    <span>{check.label}</span>
                    {check.ok ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700"><Check className="size-3" /> OK</span> : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"><AlertTriangle className="size-3" /> Flag</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm">Send test</Button>
            <Button variant="outline" size="sm">Save draft</Button>
            <Button size="sm">Approve</Button>
            <Button variant="secondary" size="sm">Request changes</Button>
            <Button variant="destructive" size="sm">Reject</Button>
            <Button variant="outline" size="sm">Schedule</Button>
          </div>
          <textarea rows={3} placeholder="Add a rejection comment..." className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring" />
        </div>
      </div>
    </div>
  );
}

export function EmailsDashboard({ initialEmails }: { initialEmails: Array<Partial<EmailRowData> & { id: string; subject: string }> }) {
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<EmailStatusKey>("draft");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<EmailRowData | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sortState, setSortState] = useState<{ field: "updatedAt" | "scheduledFor" | "subject"; direction: "asc" | "desc" }>({ field: "updatedAt", direction: "desc" });

  const rows = useMemo(() => initialEmails.map((email) => toEmailRow(email)), [initialEmails]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setIsLoading(false), 240);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (!drawerOpen) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const list = rows.filter((row) => row.statusKey === activeTab);
        const currentIndex = list.findIndex((row) => row.id === selectedRow?.id);
        const nextIndex = event.key === "ArrowDown" ? Math.min(currentIndex + 1, list.length - 1) : Math.max(currentIndex - 1, 0);
        if (list[nextIndex]) {
          event.preventDefault();
          setSelectedRow(list[nextIndex]);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, drawerOpen, rows, selectedRow]);

  const counts = tabConfig.reduce<Record<EmailStatusKey, number>>((acc, tab) => {
    acc[tab.key] = rows.filter((row) => row.statusKey === tab.key).length;
    return acc;
  }, { draft: 0, needs_approval: 0, scheduled: 0, sent: 0, failed: 0 });

  const filteredRows = useMemo(() => {
    return [...rows]
      .filter((row) => row.statusKey === activeTab)
      .filter((row) => {
        const lowerQuery = search.trim().toLowerCase();
        if (!lowerQuery) return true;
        return [row.subject, row.contact, row.company].some((value) => value.toLowerCase().includes(lowerQuery));
      })
      .sort((a, b) => {
        const field = sortState.field;
        const direction = sortState.direction === "asc" ? 1 : -1;
        const left = a[field] ?? "";
        const right = b[field] ?? "";
        return String(left).localeCompare(String(right)) * direction;
      });
  }, [rows, activeTab, search, sortState]);

  const handleSort = (field: "updatedAt" | "scheduledFor" | "subject") => {
    setSortState((current) => ({
      field,
      direction: current.field === field && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  const toggleRow = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openRow = (row: EmailRowData) => {
    setSelectedRow(row);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Emails</h1>
          <p className="max-w-xl text-sm text-muted-foreground">Review personalized drafts and keep every outbound message controlled.</p>
        </div>
        <Button size="sm" className="w-fit gap-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400">
          <Sparkles className="size-3.5" />
          New sequence
        </Button>
      </div>

      <EmailTabBar activeTab={activeTab} onChange={setActiveTab} countByTab={counts} />

      <div className="space-y-4">
        <EmailToolbar filterLabel={filter} onFilterChange={setFilter} searchValue={search} onSearchChange={setSearch} selectedCount={selectedIds.size} />

        {isLoading ? (
          <EmailTableSkeleton />
        ) : filteredRows.length === 0 ? (
          <EmptyState title="No emails in this tab" description="Nothing is blocking your outreach right now." />
        ) : (
          <EmailTable key={`${activeTab}-${filter}-${search}`} rows={filteredRows} selectedIds={selectedIds} onToggleRow={toggleRow} onOpenRow={openRow} onSort={handleSort} />
        )}
      </div>

      <EmailDetailDrawer key={selectedRow?.id ?? "empty"} row={selectedRow} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

export function DeliverabilityDashboard() {
  const [activeTab, setActiveTab] = useState<"errors" | "warnings" | "info">("errors");
  const [page, setPage] = useState(1);
  const [rows] = useState([
    { type: "Error", entity: "filazoo.com", description: "SPF or DKIM records are missing from the outbound domain.", severity: "error" },
    { type: "Warning", entity: "noreply@filazoo.com", description: "Mailbox is disconnected and rejecting replies.", severity: "warning" },
    { type: "Warning", entity: "Draft #PL-741", description: "Draft is missing an unsubscribe link before approval.", severity: "warning" },
    { type: "Info", entity: "Suppression list", description: "Three contacts are currently on the suppression list.", severity: "info" },
  ]);

  const counts = {
    errors: rows.filter((row) => row.severity === "error").length,
    warnings: rows.filter((row) => row.severity === "warning").length,
    info: rows.filter((row) => row.severity === "info").length,
  };

  const visibleRows = rows.filter((row) => {
    if (activeTab === "errors") return row.severity === "error";
    if (activeTab === "warnings") return row.severity === "warning";
    return row.severity === "info";
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = visibleRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Deliverability</h1>
          <p className="text-sm text-muted-foreground">Review mailbox health and keep every outbound message compliant.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-4">
        {[
          { key: "errors", label: "Errors", color: "text-red-600", bg: "bg-red-100 text-red-700" },
          { key: "warnings", label: "Warnings", color: "text-amber-600", bg: "bg-amber-100 text-amber-700" },
          { key: "info", label: "Info", color: "text-blue-600", bg: "bg-blue-100 text-blue-700" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setActiveTab(tab.key as "errors" | "warnings" | "info"); setPage(1); }}
            className={`rounded-xl border px-3 py-2 text-left transition-colors ${activeTab === tab.key ? "border-border bg-background shadow-sm" : "border-transparent bg-muted/40 text-muted-foreground"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`grid size-5 place-items-center rounded-md ${tab.bg}`}><ShieldAlert className="size-3.5" /></span>
              <span className="text-sm font-medium">{tab.label}</span>
            </div>
            <div className="mt-1 text-xs text-foreground/70">{counts[tab.key as keyof typeof counts]} {tab.key === "errors" ? "errors" : tab.key === "warnings" ? "warnings" : "info"}</div>
          </button>
        ))}
      </div>

      <div className="crm-table-frame crm-table-page-wide overflow-hidden border-y border-border bg-background">
        <div className="crm-table-viewport">
          <table className="crm-table min-w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2.5 font-medium">Issue</th>
                <th className="px-3 py-2.5 font-medium">Entity</th>
                <th className="px-3 py-2.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-12 text-center text-sm text-muted-foreground">No deliverability issues in this category.</td>
                </tr>
              ) : (
                pagedRows.map((row) => (
                  <tr key={`${row.entity}-${row.description}`} className="border-b border-border/80 text-sm">
                    <td className="px-3 py-3"><Badge variant={row.severity === "error" ? "destructive" : row.severity === "warning" ? "secondary" : "outline"}>{row.type}</Badge></td>
                    <td className="px-3 py-3 font-medium text-foreground">{row.entity}</td>
                    <td className="px-3 py-3 text-muted-foreground">{row.description}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={currentPage} pageCount={pageCount} start={pagedRows.length ? (currentPage - 1) * pageSize + 1 : 0} end={Math.min(currentPage * pageSize, visibleRows.length)} total={visibleRows.length} itemLabel="issues" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
      </div>
    </div>
  );
}

