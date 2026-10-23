"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SortingState, flexRender } from "@tanstack/react-table";
import { type LegacyColumnDef as ColumnDef, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useLegacyTable as useReactTable } from "@tanstack/react-table/legacy";
import { Building2, ChevronsUpDown, CircleAlert, Globe2, Mail, MapPin, MessageCircle, PackageCheck, Trash2, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { bulkUpdateCompanies } from "@/app/crm-actions";
import { AssignedOwner } from "@/components/assigned-owner";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { EmptyState } from "@/components/data-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilters, TableFilter } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import type { Company, DataMode } from "@/lib/types";

const statusClass: Record<Company["stage"], string> = {
  "Profile created": "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300",
  "Catalog sent": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  "Customer replied": "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300",
  "Qualified interest": "border-primary/30 bg-brand-soft text-primary", "Quote / bulk order": "border-primary/30 bg-brand-soft text-primary",
  "Order confirmed": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
  "Closed / not proceeding": "border-border bg-muted text-muted-foreground",
};

function ShopifyMark({ compact = false }: { compact?: boolean }) {
  const size = compact ? 16 : 24;
  return <Image src="/shopify-mark.svg" alt="Shopify" title="Shopify lead" width={size} height={size} unoptimized className="shrink-0 object-contain" />;
}

function SourceMark({ company }: { company: Company }) {
  const isShopify = company.source.includes("shopify");
  const isMeta = company.source.includes("meta") || company.source.includes("facebook") || company.source.includes("messenger");
  if (!isShopify && !isMeta) return null;
  return <span aria-label={`Source: ${company.sourceLabel}`} title={`Source: ${company.sourceLabel}`} className="absolute -right-1 -bottom-1 grid size-[22px] place-items-center rounded-full border-[3px] border-card bg-card shadow-sm">{isShopify ? <ShopifyMark compact /> : <span className="grid size-4 place-items-center rounded-full bg-[#0866ff] text-white"><MessageCircle className="size-2.5" /></span>}</span>;
}

function CompanyIdentity({ company }: { company: Company }) {
  const isShopify = company.source.includes("shopify");
  return (
    <div className="flex min-w-0 items-center gap-3.5 md:min-w-60">
      <div className="relative shrink-0">
        <Avatar className="size-7 rounded-full bg-muted">
          <AvatarFallback className="rounded-full bg-card/85 text-xs font-bold tracking-wide text-foreground backdrop-blur-sm">{company.initials}</AvatarFallback>
        </Avatar>
        <SourceMark company={company} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-5 text-primary">{company.name}</p>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <p className="max-w-40 truncate text-xs text-muted-foreground">{company.domain}</p>
          {isShopify ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#95bf47]/12 px-1.5 py-0.5 text-xs font-semibold text-[#5c7f18] dark:text-[#b5d66e]"><span className="size-1 rounded-full bg-[#78a832]" />Shopify</span> : null}
        </div>
      </div>
    </div>
  );
}

export function CompaniesTable({ companies, mode, canWrite, canDelete }: { companies: Company[]; mode: DataMode; canWrite: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [country, setCountry] = useState("all");
  const [draft, setDraft] = useState({ query: "", status: "all", country: "all" });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const countries = useMemo(() => [...new Set(companies.map((company) => company.country))].sort(), [companies]);
  const filtered = useMemo(() => companies.filter((company) => {
    const matchesQuery = `${company.name} ${company.domain} ${company.email} ${company.segment} ${company.ownerName}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || company.stage === status) && (country === "all" || company.country === country);
  }), [companies, country, query, status]);
  const shopifyCount = useMemo(() => companies.filter((company) => company.source.includes("shopify")).length, [companies]);
  const needsReviewCount = useMemo(() => companies.filter((company) => company.country === "Unknown" || company.estimatedOrderQuantity == null).length, [companies]);
  const knownCountryCount = useMemo(() => new Set(companies.map((company) => company.country).filter((item) => item !== "Unknown")).size, [companies]);

  const toggleOne = (id: string, checked: boolean) => setSelectedIds((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });

  const columns = useMemo<ColumnDef<Company>[]>(() => [
    {
      id: "select", enableSorting: false,
      header: ({ table }) => {
        const ids = table.getRowModel().rows.map((row) => row.original.id);
        const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
        return <input aria-label="Select this page" type="checkbox" checked={allSelected} className="size-4 accent-current" onChange={(event) => setSelectedIds((current) => { const next = new Set(current); for (const id of ids) { if (event.target.checked) next.add(id); else next.delete(id); } return next; })} />;
      },
      cell: ({ row }) => <input aria-label={`Select ${row.original.name}`} type="checkbox" checked={selectedIds.has(row.original.id)} className="size-4 accent-current" onChange={(event) => toggleOne(row.original.id, event.target.checked)} />,
    },
    {
      accessorKey: "name", header: "Company / customer",
      cell: ({ row }) => <Link href={`/companies/${row.original.id}`} className="text-primary underline-offset-4 hover:underline"><CompanyIdentity company={row.original} /></Link>,
    },
    { accessorKey: "email", header: "Email", cell: ({ getValue }) => <span className="flex max-w-52 items-center gap-1.5 truncate"><Mail className="size-3.5 shrink-0 text-muted-foreground/70" />{getValue<string>() || "No email"}</span> },
    { accessorKey: "ownerName", header: "Assigned manager", cell: ({ row }) => <AssignedOwner name={row.original.ownerName} initials={row.original.ownerInitials} assigned={Boolean(row.original.ownerId)} compact /> },
    { accessorKey: "country", header: "Country", cell: ({ getValue }) => { const value = getValue<string>(); return <span className={`flex items-center gap-1.5 whitespace-nowrap ${value === "Unknown" ? "text-amber-600 dark:text-amber-400" : ""}`}><MapPin className="size-3.5" />{value}</span>; } },
    { accessorKey: "segment", header: "Segment", cell: ({ getValue }) => <span className="block max-w-44 truncate">{getValue<string>()}</span> },
    { accessorKey: "stage", header: "Status", cell: ({ getValue }) => { const value = getValue<Company["stage"]>(); return <Badge variant="outline" className={statusClass[value]}>{value}</Badge>; } },
    { accessorKey: "outreachStatus", header: "Outreach", cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue<string>()}</span> },
    { accessorKey: "estimatedOrderQuantity", header: "Est. order", cell: ({ row, getValue }) => {
      const value = getValue<number | null>();
      const label = row.original.estimatedOrderLabel;
      if (label) return <span className="whitespace-nowrap font-medium text-foreground" title="Customer's submitted initial order estimate">{label}</span>;
      return value == null ? <span className="text-muted-foreground/60">Not set</span> : <span className="whitespace-nowrap font-medium text-foreground">{value.toLocaleString()} <span className="font-normal text-muted-foreground">{row.original.source.includes("shopify") ? "kg/mo" : "kg"}</span></span>;
    } },
    { accessorKey: "nextAction", header: "Next action", cell: ({ getValue }) => <span className="block max-w-48 truncate">{getValue<string>()}</span> },
  ], [selectedIds]);

  const table = useReactTable({
    data: filtered, columns, state: { sorting }, onSortingChange: setSorting, getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
  });

  const runBulkAction = (action: "contacted" | "interested" | "delete") => {
    if (!selectedIds.size) return;
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await bulkUpdateCompanies([...selectedIds], action);
        if (result?.error) toast.error(result.error);
        if (result?.success) { toast.success(result.success); setSelectedIds(new Set()); router.refresh(); }
      } catch {
        toast.error("Unable to update the selected companies. Please retry.");
      }
    });
  };

  if (companies.length === 0) return <EmptyState title={mode === "live" ? "No companies yet" : "Supabase setup required"} description={mode === "live" ? "Your Supabase companies table is connected and empty. Add or import the first company to begin." : "Add a valid project secret key to the server environment, then redeploy the app."} />;

  return <div className="flex min-w-0 flex-col gap-6">
    <ConfirmActionDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete selected companies?" description={`Delete ${selectedIds.size} selected companies and their contacts, catalogs, and pipeline history? This cannot be undone.`} onConfirm={async () => {
      const result = await bulkUpdateCompanies([...selectedIds], "delete");
      if (!result?.success) throw new Error(result?.error || "Unable to delete the selected companies.");
      toast.success(result.success);
      setSelectedIds(new Set());
      router.refresh();
    }} />
    <div className="crm-company-summary grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        { label: "Total companies", value: companies.length, detail: "Accounts and prospects", icon: Building2, tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" },
        { label: "Shopify leads", value: shopifyCount, detail: "Captured from your store", icon: PackageCheck, tone: "bg-[#95bf47]/12 text-[#5c7f18] dark:text-[#b5d66e]" },
        { label: "Markets", value: knownCountryCount, detail: "Countries identified", icon: Globe2, tone: "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" },
        { label: "Needs review", value: needsReviewCount, detail: "Missing country or estimate", icon: CircleAlert, tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
      ].map((metric) => <Card key={metric.label} className="gap-0 border-border/70 p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">{metric.label}</p><p className="mt-1 text-2xl font-semibold tracking-tight">{metric.value.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p></div><span className={`grid size-9 place-items-center rounded-xl ${metric.tone}`}><metric.icon className="size-4" /></span></div></Card>)}
    </div>

    
    <TableFilters onApply={() => { setQuery(draft.query); setStatus(draft.status); setCountry(draft.country); table.setPageIndex(0); }}>
      <TableFilter label="Search company" search><Input value={draft.query} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="Company, email, domain, or segment" /></TableFilter>
      <TableFilter label="Status"><Select value={draft.status} onValueChange={(value) => setDraft({ ...draft, status: value ?? "all" })}><SelectTrigger><SelectValue>{draft.status === "all" ? "All statuses" : draft.status}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.keys(statusClass).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></TableFilter>
      <TableFilter label="Country"><Select value={draft.country} onValueChange={(value) => setDraft({ ...draft, country: value ?? "all" })}><SelectTrigger><SelectValue>{draft.country === "all" ? "All countries" : draft.country}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All countries</SelectItem>{countries.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></TableFilter>
    </TableFilters>
    <Card className="crm-table-frame gap-0 py-0">
    {selectedIds.size > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-brand-soft px-4 py-3"><p className="mr-auto text-sm font-semibold text-primary">{selectedIds.size} selected</p><Button size="sm" variant="outline" disabled={!canWrite || pending} onClick={() => runBulkAction("contacted")}><UserRoundCheck />Mark contacted</Button><Button size="sm" variant="outline" disabled={!canWrite || pending} onClick={() => runBulkAction("interested")}>Mark interested</Button><Button size="sm" variant="destructive" disabled={!canDelete || pending} title={canDelete ? "Delete selected companies" : "Only admins can delete companies"} onClick={() => setDeleteOpen(true)}><Trash2 />Delete</Button></div>}

    {filtered.length === 0 ? <div className="p-8"><EmptyState title="No companies found" description="Try changing your search or filters to see more results." /></div> : <>
      <div className="crm-table-flex-body"><Table>
        <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id} className="hover:bg-transparent">{group.headers.map((header) => <TableHead key={header.id} aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined}>{header.isPlaceholder ? null : header.column.getCanSort() ? <button className="flex items-center gap-1 hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}<ChevronsUpDown className="size-3" /></button> : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
        <TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} className="group cursor-pointer" tabIndex={0} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,[role=checkbox]")) router.push(`/companies/${row.original.id}`); }} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter") router.push(`/companies/${row.original.id}`); }}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} >{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
      </Table></div>
    </>}
    </Card>
      <TablePagination page={table.getState().pagination.pageIndex + 1} pageCount={table.getPageCount()} start={table.getRowModel().rows.length ? table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1 : 0} end={Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, filtered.length)} total={filtered.length} itemLabel="companies" onPrevious={() => table.previousPage()} onNext={() => table.nextPage()} onPageChange={(page) => table.setPageIndex(page - 1)} />
  </div>;
}
