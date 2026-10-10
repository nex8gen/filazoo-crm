"use client";

import { useMemo, useState } from "react";
import { type SortingState, flexRender } from "@tanstack/react-table";
import { type LegacyColumnDef as ColumnDef, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useLegacyTable as useReactTable } from "@tanstack/react-table/legacy";
import { ChevronLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Company, DataMode } from "@/lib/types";

const statusClass: Record<Company["stage"], string> = {
  New: "",
  Contacted: "",
  Replied: "border-primary/30 bg-brand-soft text-primary",
  Interested: "border-primary/30 bg-brand-soft text-primary",
  "Big order": "border-primary/30 bg-brand-soft text-primary",
  Won: "border-primary/30 bg-brand-soft text-primary",
  Lost: "opacity-60",
};

const columns: ColumnDef<Company>[] = [
  {
    accessorKey: "name",
    header: "Company",
    cell: ({ row }) => <div className="flex items-center gap-3"><Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg bg-muted text-xs">{row.original.initials}</AvatarFallback></Avatar><div className="min-w-0"><p className="font-medium text-foreground">{row.original.name}</p><p className="text-xs text-muted-foreground">{row.original.domain}</p></div></div>,
  },
  { accessorKey: "country", header: "Country" },
  { accessorKey: "segment", header: "Segment" },
  {
    accessorKey: "stage",
    header: "Status",
    cell: ({ getValue }) => { const status = getValue<Company["stage"]>(); return <Badge variant="outline" className={statusClass[status]}>{status}</Badge>; },
  },
  {
    accessorKey: "fitScore",
    header: "Fit score",
    cell: ({ getValue }) => <div className="flex items-center gap-2"><span className="w-6 font-medium text-foreground">{getValue<number>()}</span><div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${getValue<number>()}%` }} /></div></div>,
  },
  { accessorKey: "nextAction", header: "Next action" },
];

export function CompaniesTable({ companies, mode }: { companies: Company[]; mode: DataMode }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [country, setCountry] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selected, setSelected] = useState<Company | null>(null);

  const countries = useMemo(() => [...new Set(companies.map((company) => company.country))].sort(), [companies]);
  const filtered = useMemo(() => companies.filter((company) => {
    const matchesQuery = `${company.name} ${company.domain} ${company.segment}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || company.stage === status) && (country === "all" || company.country === country);
  }), [companies, country, query, status]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 8 } },
  });

  if (companies.length === 0) {
    return <EmptyState title={mode === "live" ? "No companies yet" : "Supabase setup required"} description={mode === "live" ? "Your Supabase companies table is connected and empty. Add or import the first company to begin." : "Add a valid project secret key to the server environment, then redeploy the app."} />;
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies…" className="pl-9" /></div>
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={(value) => setStatus(value ?? "all")}><SelectTrigger className="min-w-36"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.keys(statusClass).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
          <Select value={country} onValueChange={(value) => setCountry(value ?? "all")}><SelectTrigger className="min-w-36"><SelectValue placeholder="All countries" /></SelectTrigger><SelectContent><SelectItem value="all">All countries</SelectItem>{countries.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        </div>
        <p className="text-xs text-muted-foreground lg:ml-auto">{filtered.length} companies</p>
      </div>

      {filtered.length === 0 ? <EmptyState title="No companies found" description="Try changing your search or filters to see more results." /> : (
        <Card className="overflow-hidden py-0 shadow-none">
          <Table>
            <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}><button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getCanSort() && <ChevronsUpDown className="size-3" />}</button></TableHead>)}</TableRow>)}</TableHeader>
            <TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} className="cursor-pointer" tabIndex={0} onClick={() => setSelected(row.original)} onKeyDown={(event) => { if (event.key === "Enter") setSelected(row.original); }}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} className="text-xs text-muted-foreground">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-3"><p className="text-xs text-muted-foreground">Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</p><div className="flex gap-1"><Button size="icon-sm" variant="outline" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft /><span className="sr-only">Previous page</span></Button><Button size="icon-sm" variant="outline" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight /><span className="sr-only">Next page</span></Button></div></div>
        </Card>
      )}

      <CompanySheet company={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </>
  );
}

function CompanySheet({ company, onOpenChange }: { company: Company | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={Boolean(company)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {company && <><SheetHeader className="border-b"><div className="flex items-center gap-3 pr-8"><Avatar className="size-10 rounded-lg"><AvatarFallback className="rounded-lg bg-brand-soft text-primary">{company.initials}</AvatarFallback></Avatar><div><SheetTitle>{company.name}</SheetTitle><SheetDescription>{company.domain} · {company.country}</SheetDescription></div></div></SheetHeader>
        <Tabs defaultValue="overview" className="px-4 pb-6"><TabsList variant="line" className="w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="contacts">Contacts</TabsTrigger><TabsTrigger value="emails">Emails</TabsTrigger><TabsTrigger value="catalog">Catalog</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
          <TabsContent value="overview" className="space-y-6 pt-4"><p className="text-sm leading-6 text-muted-foreground">{company.summary}</p><div className="grid grid-cols-2 gap-4"><Detail label="Segment" value={company.segment} /><Detail label="Fit score" value={`${company.fitScore}/100`} /><Detail label="Status" value={company.stage} /><Detail label="Next action" value={company.nextAction} /></div><div><p className="mb-2 text-xs font-medium">Interest tags</p><div className="flex flex-wrap gap-2">{company.tags.length ? company.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>) : <span className="text-xs text-muted-foreground">No tags yet</span>}</div></div></TabsContent>
          <TabsContent value="contacts" className="pt-4">{company.email ? <div className="rounded-lg border p-4"><p className="font-medium">{company.contact}</p><p className="text-xs text-muted-foreground">{company.contactRole}</p><p className="mt-2 text-xs text-primary">{company.email}</p></div> : <EmptyState title="No contact yet" description="Add a verified decision-maker before starting outreach." />}</TabsContent>
          <TabsContent value="emails" className="pt-4"><EmptyState title="No email history shown" description="Company email history will be added to this panel next." /></TabsContent>
          <TabsContent value="catalog" className="pt-4"><EmptyState title="No catalog yet" description="Generate a tailored catalog when the company is qualified." /></TabsContent>
          <TabsContent value="activity" className="pt-4"><EmptyState title="No activity yet" description="Events for this company will appear here." /></TabsContent>
        </Tabs></>}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}
