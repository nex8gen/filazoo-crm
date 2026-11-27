"use client";


import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { type SortingState, flexRender } from "@tanstack/react-table";
import { type LegacyColumnDef as ColumnDef, getCoreRowModel, useLegacyTable as useReactTable } from "@tanstack/react-table/legacy";
import { Building2, ChevronsUpDown, Globe2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { bulkUpdateCompanies } from "@/app/crm-actions";
import { AssignedOwner } from "@/components/assigned-owner";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { EmptyState } from "@/components/data-state";
import { CompanyAvatar } from "@/components/company-avatar";
import { CompanyOrderBadge } from "@/components/company-order-badge";
import { CustomerTagBadge } from "@/components/customer-tag-badges";
import { CompanyListTags } from "@/components/company-list-tags";
import { CustomerTagHealth } from "@/components/customer-tag-health";
import { CompanyListAnalytics } from "@/components/company-list-analytics";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { TableColumnsTrigger } from "@/components/ui/table-columns-trigger";
import { useTableColumns } from "@/components/table-columns-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilters, TableFilter } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import type { Company } from "@/lib/types";
import { companyListHref, type CompanyListPage, type CompanyListRequest } from "@/lib/company-list";
import { countryFlagCode } from "@/lib/country-flags";
import { customerTagValues } from "@/lib/customer-tags";
import { useCachedPage } from "@/components/use-cached-page";
import { Skeleton } from "@/components/ui/skeleton";
import { usePreferences } from "@/components/preferences-provider";

function companyPageKey(search: string, pageSize?: number) {
  const params = new URLSearchParams(search.replace(/^.*\?/, ""));
  if (pageSize) params.set("pageSize", String(pageSize));
  if (!params.has("page")) params.set("page", "1");
  params.sort();
  return `/companies?${params}`;
}
type CompanyPageSnapshot = { result: CompanyListPage; request: CompanyListRequest; asOf: string };
async function readCompanyPage(key: string, signal: AbortSignal): Promise<CompanyPageSnapshot> {
  const response = await fetch(key.replace("/companies?", "/api/companies/page?"), { signal, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.result || !data?.request) throw new Error(data?.error || "Unable to load companies. Please retry.");
  return data;
}

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
        <CustomerTagHealth status={company.tagProcessingStatus} reason={company.tagProcessingReason} />
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

export function CompaniesTable({ result: initialResult, request: initialRequest, canDelete, analyticsAsOf }: { result: CompanyListPage; request: CompanyListRequest; canDelete: boolean; analyticsAsOf: string }) {
  const searchParams = useSearchParams();
  const { preferences } = usePreferences();
  const page = useCachedPage(companyPageKey(searchParams.toString(), initialRequest.pageSize), { result: initialResult, request: initialRequest, asOf: analyticsAsOf }, readCompanyPage);
  const { key: cacheKey, select: selectPage } = page;
  const { result, request, asOf } = page.value;
  const pending = page.loading;
  const { companies, mode, total, countries, buckets } = result;
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(request.query);
  const [queryDraft, setQueryDraft] = useState(request.query);
  // Reset a local draft when browser back/forward supplies another server query.
  if (query !== request.query) {
    setQuery(request.query);
    if (queryDraft === query) setQueryDraft(request.query);
  }
  const { country, tag } = request;
  const sorting: SortingState = request.sort === "createdAt" ? [] : [{ id: request.sort, desc: request.descending }];
  const navigate = useCallback((changes: Record<string, string | number | undefined>) => {
    setSelectedIds(new Set());
    const href = companyListHref(cacheKey.split("?")[1] ?? "", changes);
    void selectPage(companyPageKey(href)).then(success => { if (success) window.history.replaceState(null, "", href); });
  }, [cacheKey, selectPage]);
  useEffect(() => {
    if (preferences.tablePageSize === request.pageSize) return;
    const timer = setTimeout(() => navigate({ page: 1, pageSize: preferences.tablePageSize }), 0);
    return () => clearTimeout(timer);
  }, [preferences.tablePageSize, request.pageSize, navigate]);
  useEffect(() => {
    if (queryDraft === request.query) return;
    const timer = setTimeout(() => navigate({ q: queryDraft, page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [queryDraft, request.query, navigate]);
  useEffect(() => {
    const back = () => { if (window.location.pathname === "/companies") { setSelectedIds(new Set()); void selectPage(companyPageKey(window.location.search, preferences.tablePageSize)); } };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [selectPage, preferences.tablePageSize]);
  const [columnVisibility, setColumnVisibility] = useTableColumns("companies");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selectedCompanyIds = useMemo(() => companies.filter(company => selectedIds.has(company.id)).map(company => company.id), [companies, selectedIds]);

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
        return <Checkbox disabled={pending} aria-label="Select companies on this page" checked={allSelected} indeterminate={!allSelected && ids.some(id => selectedIds.has(id))} onCheckedChange={checked => setSelectedIds((current) => { const next = new Set(current); for (const id of ids) { if (checked) next.add(id); else next.delete(id); } return next; })} />;
      },
      cell: ({ row }) => <Checkbox aria-label={`Select ${row.original.name}`} checked={selectedIds.has(row.original.id)} onCheckedChange={checked => toggleOne(row.original.id, checked)} />,
    },
    {
      accessorKey: "name", header: "Company / customer", enableHiding: false,
      cell: ({ row }) => <Link prefetch={false} href={`/companies/${row.original.id}`} className="text-primary no-underline hover:no-underline"><CompanyIdentity company={row.original} /></Link>,
    },
    { accessorKey: "email", header: "Email", cell: ({ getValue }) => <span className="flex max-w-52 items-center gap-1.5 truncate"><Mail className="size-3.5 shrink-0 text-muted-foreground/70" />{getValue<string>() || "No email"}</span> },
    { accessorKey: "ownerName", header: "Assigned manager", cell: ({ row }) => <AssignedOwner name={row.original.ownerName} initials={row.original.ownerInitials} imageUrl={row.original.ownerAvatarUrl} assigned={Boolean(row.original.ownerId)} compact /> },
    { accessorKey: "addedAt", header: "Added", cell: ({ getValue }) => { const value = getValue<string | undefined>(); return <span className="whitespace-nowrap" title={value || undefined}>{value ? addedAtFormatter.format(new Date(value)) : "Unknown"}</span>; } },
    { accessorKey: "country", header: "Country", cell: ({ getValue }) => <CountryFlag country={getValue<string>()} /> },
    { accessorKey: "segment", header: "Segment", cell: ({ getValue }) => <span className="block max-w-44 truncate">{getValue<string>()}</span> },
  ], [selectedIds, pending]);

  const table = useReactTable({
    data: companies, columns, state: { sorting, columnVisibility, pagination: { pageSize: request.pageSize, pageIndex: request.page - 1 } },
    onSortingChange: updater => { const next = typeof updater === "function" ? updater(sorting) : updater; navigate({ sort: next[0]?.id, direction: next[0] ? next[0].desc ? "desc" : "asc" : undefined, page: 1 }); },
    onColumnVisibilityChange: setColumnVisibility, getRowId: row => row.id,
    manualSorting: true, manualPagination: true, enableMultiSort: false, rowCount: total,
    getCoreRowModel: getCoreRowModel(),
  });

  if (total === 0 && !pending && !request.query && country === "all" && tag === "all") return <EmptyState icon={Building2} title={mode === "live" ? "No companies yet" : "Company data is unavailable"} description={mode === "live" ? "Add or import your first company to start building account history." : "Check your workspace connection in Settings and try again."} />;

  return <div className="flex min-w-0 flex-col gap-6" aria-busy={pending}>
    <ConfirmActionDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete selected companies?" description={`Delete ${selectedCompanyIds.length} selected companies and their contacts, catalogs, and account history? This cannot be undone.`} onConfirm={async () => {
      if (!canDelete || !selectedCompanyIds.length) throw new Error("Select companies you have permission to delete.");
      const result = await bulkUpdateCompanies(selectedCompanyIds, "delete");
      if (!result?.success) throw new Error(result?.error || "Unable to delete the selected companies.");
      toast.success(result.success);
      setSelectedIds(new Set());
      router.refresh();
    }} />
    <div className="-mb-3"><CompanyListAnalytics buckets={buckets} asOf={asOf} /></div>
    {page.error ? <div role="alert" className="flex items-center gap-3 text-sm text-destructive">{page.error}<Button variant="outline" size="sm" onClick={() => void page.retry().then(success => { if (success) window.history.replaceState(null, "", page.requestedKey); })}>Retry</Button></div> : null}
    <TableFilters actions={
      <DropdownMenu>
        <TableColumnsTrigger />
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
      <TableFilter label="Search company" search><Input value={queryDraft} onChange={event => setQueryDraft(event.target.value)} placeholder="Company, email, domain, segment, or tag" /></TableFilter>
      <TableFilter label="Customer tag"><Select disabled={pending} value={tag} onValueChange={value => navigate({ tag: value ?? "all", q: queryDraft, page: 1 })}><SelectTrigger className="min-w-64"><SelectValue /></SelectTrigger><SelectContent className="min-w-72"><SelectItem value="all">All tags</SelectItem>{customerTagValues.map(value => <SelectItem key={value} value={value}><CustomerTagBadge tag={value} /></SelectItem>)}</SelectContent></Select></TableFilter>
      <TableFilter label="Country"><Select disabled={pending} value={country} onValueChange={value => navigate({ country: value ?? "all", q: queryDraft, page: 1 })}><SelectTrigger><SelectValue>{country === "all" ? "All countries" : country}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All countries</SelectItem>{countries.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></TableFilter>
    </TableFilters>
    <Card className="crm-table-frame gap-0 py-0">
    {selectedCompanyIds.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-brand-soft px-4 py-2"><p className="mr-auto text-sm font-semibold text-primary" aria-live="polite">{selectedCompanyIds.length} selected</p><Button size="sm" variant="destructive" disabled={!canDelete} title={canDelete ? "Delete selected companies" : "Only admins can delete companies"} onClick={() => setDeleteOpen(true)}><Trash2 />Delete</Button></div>}

    {!pending && companies.length === 0 ? <div className="p-8"><EmptyState icon={Building2} title="No companies found" description="Try changing your search or filters to see more results." /></div> : <>
      <div className="crm-table-flex-body"><Table>
        <caption className="sr-only">Companies, contact details, account owners, and business segments</caption>
        <TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id} className="hover:bg-transparent">{group.headers.map((header) => <TableHead key={header.id} data-column={header.column.id} aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined}>{header.isPlaceholder ? null : header.column.getCanSort() ? <button disabled={pending} className="flex items-center gap-1 hover:text-foreground" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}<ChevronsUpDown className="size-3" /></button> : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
        <TableBody>{pending ? Array.from({ length: Math.min(10, request.pageSize) }, (_, index) => <TableRow key={index} aria-hidden="true">{table.getVisibleLeafColumns().map(column => <TableCell key={column.id} className="h-[73px]"><Skeleton className={column.id === "select" ? "size-4" : "h-4 w-4/5"} /></TableCell>)}</TableRow>) : table.getRowModel().rows.map((row) => <TableRow key={row.id} className="group cursor-pointer" tabIndex={0} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,[role=checkbox]")) router.push(`/companies/${row.original.id}`); }} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter") router.push(`/companies/${row.original.id}`); }}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} data-column={cell.column.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
      </Table></div>
    </>}
    </Card>
      <span className="sr-only" role="status">{pending ? "Loading companies…" : ""}</span>
      <TablePagination disabled={pending || queryDraft !== request.query} page={request.page} pageCount={Math.ceil(total / request.pageSize)} start={companies.length ? (request.page - 1) * request.pageSize + 1 : 0} end={Math.min(request.page * request.pageSize, total)} total={total} itemLabel="companies" onPrevious={() => navigate({ page: request.page - 1 })} onNext={() => navigate({ page: request.page + 1 })} onPageChange={page => navigate({ page })} />
  </div>;
}
