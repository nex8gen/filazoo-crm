"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type SortingState, flexRender } from "@tanstack/react-table";
import { type LegacyColumnDef as ColumnDef, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useLegacyTable as useReactTable } from "@tanstack/react-table/legacy";
import { ChevronLeft, ChevronRight, ChevronsUpDown, MessageCircle, Search, Store, Trash2, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { bulkUpdateCompanies } from "@/app/crm-actions";
import { EmptyState } from "@/components/data-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Company, DataMode } from "@/lib/types";

const statusClass: Record<Company["stage"], string> = {
  New: "", Contacted: "", Replied: "border-primary/30 bg-brand-soft text-primary",
  Interested: "border-primary/30 bg-brand-soft text-primary", "Big order": "border-primary/30 bg-brand-soft text-primary",
  Won: "border-primary/30 bg-brand-soft text-primary", Lost: "opacity-60",
};

function SourceMark({ company }: { company: Company }) {
  const isShopify = company.source.includes("shopify");
  const isMeta = company.source.includes("meta") || company.source.includes("facebook") || company.source.includes("messenger");
  if (!isShopify && !isMeta) return null;
  return <span title={`Source: ${company.sourceLabel}`} className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border-2 border-card bg-foreground text-background">{isShopify ? <Store className="size-2.5" /> : <MessageCircle className="size-2.5" />}</span>;
}

export function CompaniesTable({ companies, mode, canWrite, canDelete }: { companies: Company[]; mode: DataMode; canWrite: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [country, setCountry] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const countries = useMemo(() => [...new Set(companies.map((company) => company.country))].sort(), [companies]);
  const filtered = useMemo(() => companies.filter((company) => {
    const matchesQuery = `${company.name} ${company.domain} ${company.email} ${company.segment}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || company.stage === status) && (country === "all" || company.country === country);
  }), [companies, country, query, status]);

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
      cell: ({ row }) => <div className="flex min-w-48 items-center gap-3"><div className="relative"><Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg bg-muted text-xs">{row.original.initials}</AvatarFallback></Avatar><SourceMark company={row.original} /></div><div className="min-w-0"><p className="font-medium text-foreground">{row.original.name}</p><p className="truncate text-xs text-muted-foreground">{row.original.domain}</p></div></div>,
    },
    { accessorKey: "email", header: "Email", cell: ({ getValue }) => <span className="block max-w-52 truncate">{getValue<string>() || "No email"}</span> },
    { accessorKey: "country", header: "Country" },
    { accessorKey: "segment", header: "Segment", cell: ({ getValue }) => <span className="block max-w-44 truncate">{getValue<string>()}</span> },
    { accessorKey: "stage", header: "Status", cell: ({ getValue }) => { const value = getValue<Company["stage"]>(); return <Badge variant="outline" className={statusClass[value]}>{value}</Badge>; } },
    { accessorKey: "outreachStatus", header: "Outreach", cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue<string>()}</span> },
    { accessorKey: "estimatedOrderQuantity", header: "Est. order", cell: ({ getValue }) => { const value = getValue<number | null>(); return value == null ? "—" : value.toLocaleString(); } },
    { accessorKey: "nextAction", header: "Next action", cell: ({ getValue }) => <span className="block max-w-48 truncate">{getValue<string>()}</span> },
  ], [selectedIds]);

  const table = useReactTable({
    data: filtered, columns, state: { sorting }, onSortingChange: setSorting, getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });

  const runBulkAction = (action: "contacted" | "interested" | "delete") => {
    if (!selectedIds.size) return;
    if (action === "delete" && !window.confirm(`Delete ${selectedIds.size} selected ${selectedIds.size === 1 ? "company" : "companies"}? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await bulkUpdateCompanies([...selectedIds], action);
      if (result?.error) toast.error(result.error);
      if (result?.success) { toast.success(result.success); setSelectedIds(new Set()); router.refresh(); }
    });
  };

  if (companies.length === 0) return <EmptyState title={mode === "live" ? "No companies yet" : "Supabase setup required"} description={mode === "live" ? "Your Supabase companies table is connected and empty. Add or import the first company to begin." : "Add a valid project secret key to the server environment, then redeploy the app."} />;

  return <>
    <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative flex-1 lg:max-w-sm"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies…" className="pl-9" /></div>
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={(value) => setStatus(value ?? "all")}><SelectTrigger className="min-w-36"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.keys(statusClass).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={country} onValueChange={(value) => setCountry(value ?? "all")}><SelectTrigger className="min-w-36"><SelectValue placeholder="All countries" /></SelectTrigger><SelectContent><SelectItem value="all">All countries</SelectItem>{countries.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
      </div>
      <p className="text-xs text-muted-foreground lg:ml-auto">{filtered.length} companies</p>
    </div>

    {selectedIds.size > 0 && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2"><p className="mr-auto text-sm font-medium">{selectedIds.size} selected</p><Button size="sm" variant="outline" disabled={!canWrite || pending} onClick={() => runBulkAction("contacted")}><UserRoundCheck />Mark contacted</Button><Button size="sm" variant="outline" disabled={!canWrite || pending} onClick={() => runBulkAction("interested")}>Mark interested</Button><Button size="sm" variant="destructive" disabled={!canDelete || pending} title={canDelete ? "Delete selected companies" : "Only admins can delete companies"} onClick={() => runBulkAction("delete")}><Trash2 />Delete</Button></div>}

    {filtered.length === 0 ? <EmptyState title="No companies found" description="Try changing your search or filters to see more results." /> : <Card className="overflow-hidden py-0 shadow-none">
      <div className="overflow-x-auto"><Table>
        <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id} className="whitespace-nowrap">{header.isPlaceholder ? null : header.column.getCanSort() ? <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}<ChevronsUpDown className="size-3" /></button> : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
        <TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} className="cursor-pointer" tabIndex={0} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,[role=checkbox]")) router.push(`/companies/${row.original.id}`); }} onKeyDown={(event) => { if (event.key === "Enter") router.push(`/companies/${row.original.id}`); }}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} className="text-xs text-muted-foreground">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
      </Table></div>
      <div className="flex items-center justify-between border-t px-4 py-3"><p className="text-xs text-muted-foreground">Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</p><div className="flex gap-1"><Button size="icon-sm" variant="outline" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft /><span className="sr-only">Previous page</span></Button><Button size="icon-sm" variant="outline" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight /><span className="sr-only">Next page</span></Button></div></div>
    </Card>}
  </>;
}
