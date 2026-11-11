"use client";


import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type SortingState, flexRender } from "@tanstack/react-table";
import { type LegacyColumnDef as ColumnDef, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useLegacyTable as useReactTable } from "@tanstack/react-table/legacy";
import { Building2, ChevronsUpDown, Columns3, Globe2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { bulkUpdateCompanies } from "@/app/crm-actions";
import { AssignedOwner } from "@/components/assigned-owner";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { EmptyState } from "@/components/data-state";
import { CompanyAvatar } from "@/components/company-avatar";
import { CompanyOrderBadge } from "@/components/company-order-badge";
import { CustomerTagBadge } from "@/components/customer-tag-badges";
import { CompanyListTags } from "@/components/company-list-tags";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilters, TableFilter } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import type { Company, DataMode } from "@/lib/types";
import { usePreferences } from "@/components/preferences-provider";
import { useWorkspaceState } from "@/components/workspace-memory";
import { countryFlagCode } from "@/lib/country-flags";
import { customerTagValues } from "@/lib/customer-tags";

const addedAtFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "Asia/Shanghai",
  dateStyle: "medium",
});

function CompanyIdentity({ company }: { company: Company }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5 md:min-w-60">
      <div className="isolate flex shrink-0 items-center">
        {company.paidOrderCount > 0 && <CompanyOrderBadge count={company.paidOrderCount} className="z-10 -mr-1.5" />}
        <CompanyAvatar company={company} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-5 text-primary">{company.name}</p>
        <CompanyListTags key={(company.customerTags ?? []).join("|")} tags={company.customerTags} className="mt-1" />
      </div>
    </div>
  );
}

function CountryFlag({ country }: { country: string }) {
  const code = countryFlagCode(country);
  const label = country.trim() || "Unknown country";
  return <span className="inline-flex h-6 items-center gap-2" title={label}>
    {code ? <Image src={`/flags/${code}.svg`} alt="" width={24} height={18} className="h-[18px] w-6 rounded-sm object-cover ring-1 ring-border/50" /> : <Globe2 aria-hidden className="size-5 text-muted-foreground" />}
    <span>{label}</span>
  </span>;
}

export function CompaniesTable({ companies, mode, canDelete, viewKey = "all" }: { companies: Company[]; mode: DataMode; canWrite: boolean; canDelete: boolean; viewKey?: string }) {
  const { preferences } = usePreferences();
  const memoryKey = `companies.${viewKey}`;
  const [pagination, setPagination] = useWorkspaceState(`${memoryKey}.pagination`, { pageIndex: 0, pageSize: preferences.tablePageSize as number });
  const router = useRouter();
  const [query, setQuery] = useWorkspaceState(`${memoryKey}.query`, "");
  const [country, setCountry] = useWorkspaceState(`${memoryKey}.country`, "all");
  const [tag, setTag] = useWorkspaceState(`${memoryKey}.tag`, "all");
  const [draft, setDraft] = useWorkspaceState(`${memoryKey}.filters`, { country: "all" });
  const [sorting, setSorting] = useWorkspaceState<SortingState>(`${memoryKey}.sorting`, []);
  const [columnVisibility, setColumnVisibility] = useWorkspaceState<Record<string, boolean>>(`${memoryKey}.columns`, { addedAt: false });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selectedCompanyIds = useMemo(() => companies.filter(company => selectedIds.has(company.id)).map(company => company.id), [companies, selectedIds]);

  const countries = useMemo(() => [...new Set(companies.map((company) => company.country).filter(country => country.trim()))].sort(), [companies]);
  const filtered = useMemo(() => companies.filter((company) => {
    const matchesQuery = `${company.name} ${company.domain} ${company.email} ${company.segment} ${company.ownerName} ${(company.customerTags ?? []).join(" ")}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (country === "all" || company.country === country) && (tag === "all" || (company.customerTags ?? []).some(value => value === tag));
  }), [companies, country, query, tag]);

  const toggleOne = (id: string, checked: boolean) => setSelectedIds((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });

  const columns = useMemo<ColumnDef<Company>[]>(() => [
    {
      id: "select", enableSorting: false, enableHiding: false,
      header: ({ table }) => {
        const ids = table.getRowModel().rows.map((row) => row.original.id);
        const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
        return <Checkbox aria-label="Select companies on this page" checked={allSelected} indeterminate={!allSelected && ids.some(id => selectedIds.has(id))} onCheckedChange={checked => setSelectedIds((current) => { const next = new Set(current); for (const id of ids) { if (checked) next.add(id); else next.delete(id); } return next; })} />;
      },
      cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.name}`} checked={selectedIds.has(row.original.id)} onCheckedChange={checked => toggleOne(row.original.id, checked)} />,
    },
    {
      accessorKey: "name", header: "Company / customer", enableHiding: false,
      cell: ({ row }) => <Link href={`/companies/${row.original.id}`} className="text-primary no-underline hover:no-underline"><CompanyIdentity company={row.original} /></Link>,
    },
    { accessorKey: "email", header: "Email", cell: ({ getValue }) => <span className="flex max-w-52 items-center gap-1.5 truncate"><Mail className="size-3.5 shrink-0 text-muted-foreground/70" />{getValue<string>() || "No email"}</span> },
    { accessorKey: "ownerName", header: "Assigned manager", cell: ({ row }) => <AssignedOwner name={row.original.ownerName} initials={row.original.ownerInitials} imageUrl={row.original.ownerAvatarUrl} assigned={Boolean(row.original.ownerId)} compact /> },
    { accessorKey: "addedAt", header: "Added", cell: ({ getValue }) => { const value = getValue<string | undefined>(); return <span className="whitespace-nowrap" title={value || undefined}>{value ? addedAtFormatter.format(new Date(value)) : "Unknown"}</span>; } },
    { accessorKey: "country", header: "Country", cell: ({ getValue }) => <CountryFlag country={getValue<string>()} /> },
    { accessorKey: "segment", header: "Segment", cell: ({ getValue }) => <span className="block max-w-44 truncate">{getValue<string>()}</span> },
  ], [selectedIds]);

  const table = useReactTable({
    data: filtered, columns, state: { sorting, columnVisibility, pagination: { pageSize: preferences.tablePageSize, pageIndex: Math.min(pagination.pageIndex, Math.max(0, Math.ceil(filtered.length / preferences.tablePageSize) - 1)) } }, onSortingChange: setSorting, onColumnVisibilityChange: setColumnVisibility, onPaginationChange: setPagination, getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  });

  if (companies.length === 0) return <EmptyState icon={Building2} title={mode === "live" ? "No companies yet" : "Company data is unavailable"} description={mode === "live" ? "Add or import your first company to start building account history." : "Check your workspace connection in Settings and try again."} />;

  return <div className="flex min-w-0 flex-col gap-6">
    <ConfirmActionDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete selected companies?" description={`Delete ${selectedCompanyIds.length} selected companies and their contacts, catalogs, and account history? This cannot be undone.`} onConfirm={async () => {
      if (!canDelete || !selectedCompanyIds.length) throw new Error("Select companies you have permission to delete.");
      const result = await bulkUpdateCompanies(selectedCompanyIds, "delete");
      if (!result?.success) throw new Error(result?.error || "Unable to delete the selected companies.");
      toast.success(result.success);
      setSelectedIds(new Set());
      router.refresh();
    }} />
    <TableFilters onApply={() => { setCountry(draft.country); table.setPageIndex(0); }} actions={
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}><Columns3 />Columns</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            {table.getAllLeafColumns().filter((column) => column.getCanHide()).map((column) => <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={(checked) => column.toggleVisibility(checked)} closeOnClick={false}>{String(column.columnDef.header)}</DropdownMenuCheckboxItem>)}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => table.resetColumnVisibility()}>Show all columns</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    }>
      <TableFilter label="Search company" search><Input value={query} onChange={(event) => { setQuery(event.target.value); table.setPageIndex(0); }} placeholder="Company, email, domain, segment, or tag" /></TableFilter>
      <TableFilter label="Customer tag"><Select value={tag} onValueChange={value => { setTag(value ?? "all"); table.setPageIndex(0); }}><SelectTrigger className="min-w-64"><SelectValue /></SelectTrigger><SelectContent className="min-w-72"><SelectItem value="all">All tags</SelectItem>{customerTagValues.map(value => <SelectItem key={value} value={value}><CustomerTagBadge tag={value} /></SelectItem>)}</SelectContent></Select></TableFilter>
      <TableFilter label="Country"><Select value={draft.country} onValueChange={(value) => setDraft({ ...draft, country: value ?? "all" })}><SelectTrigger><SelectValue>{draft.country === "all" ? "All countries" : draft.country}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All countries</SelectItem>{countries.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></TableFilter>
    </TableFilters>
    <Card className="crm-table-frame gap-0 py-0">
    {selectedCompanyIds.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-brand-soft px-4 py-2"><p className="mr-auto text-sm font-semibold text-primary" aria-live="polite">{selectedCompanyIds.length} selected</p><Button size="sm" variant="destructive" disabled={!canDelete} title={canDelete ? "Delete selected companies" : "Only admins can delete companies"} onClick={() => setDeleteOpen(true)}><Trash2 />Delete</Button></div>}

    {filtered.length === 0 ? <div className="p-8"><EmptyState icon={Building2} title="No companies found" description="Try changing your search or filters to see more results." /></div> : <>
      <div className="crm-table-flex-body"><Table>
        <caption className="sr-only">Companies, contact details, account owners, and business segments</caption>
        <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id} className="hover:bg-transparent">{group.headers.map((header) => <TableHead key={header.id} data-column={header.column.id} aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined}>{header.isPlaceholder ? null : header.column.getCanSort() ? <button className="flex items-center gap-1 hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}<ChevronsUpDown className="size-3" /></button> : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
        <TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} className="group cursor-pointer" tabIndex={0} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,[role=checkbox]")) router.push(`/companies/${row.original.id}`); }} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter") router.push(`/companies/${row.original.id}`); }}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} data-column={cell.column.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
      </Table></div>
    </>}
    </Card>
      <TablePagination page={table.getState().pagination.pageIndex + 1} pageCount={table.getPageCount()} start={table.getRowModel().rows.length ? table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1 : 0} end={Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, filtered.length)} total={filtered.length} itemLabel="companies" onPrevious={() => table.previousPage()} onNext={() => table.nextPage()} onPageChange={(page) => table.setPageIndex(page - 1)} />
  </div>;
}
