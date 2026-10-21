"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Search, SlidersHorizontal } from "lucide-react";
import { filterCompanyCatalogs } from "@/lib/company-catalogs";
import type { Catalog } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";

const PAGE_SIZE = 20;

function formatCatalogDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

export function CompanyCatalogsTable({ catalogs }: { catalogs: Catalog[] }) {
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState("all");
  const [page, setPage] = useState(1);

  const currencies = useMemo(
    () => [...new Set(catalogs.map((catalog) => catalog.currency))].sort(),
    [catalogs],
  );

  const filtered = useMemo(
    () => filterCompanyCatalogs(catalogs, query, currency),
    [catalogs, query, currency],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleCatalogs = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="crm-table-toolbar crm-table-page-wide flex-col lg:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            className="pl-8"
            placeholder="Search company, SKU, or version…"
            aria-label="Search company catalogs"
          />
        </div>

        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <select
            value={currency}
            onChange={(event) => { setCurrency(event.target.value); setPage(1); }}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            aria-label="Filter by currency"
          >
            <option value="all">All currencies</option>
            {currencies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <p>{filtered.length} catalogs</p>
      </div>

      <Card className="crm-table-frame crm-table-page-wide gap-0 py-0 shadow-none">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-64 pl-4">Company</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead className="min-w-72">Products</TableHead>
              <TableHead>PDF</TableHead>
              <TableHead className="pr-4 text-right">Price date</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {visibleCatalogs.map((catalog) => (
              <TableRow key={catalog.id}>
                <TableCell className="pl-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{catalog.company}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Catalog v{catalog.version}</p>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="space-y-1">
                    <Badge variant="outline">{catalog.currency}</Badge>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="space-y-2">
                    <Badge variant="secondary">{catalog.productSkus.length} products</Badge>
                    {catalog.productSkus.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {catalog.productSkus.slice(0, 4).map((sku) => (
                          <span key={`${catalog.id}-${sku}`} className="rounded-md border bg-muted/40 px-2 py-1 text-[11px] font-mono">
                            {sku}
                          </span>
                        ))}
                        {catalog.productSkus.length > 4 ? (
                          <span className="self-center text-[11px] text-muted-foreground">+{catalog.productSkus.length - 4} more</span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Empty catalog shell</p>
                    )}
                  </div>
                </TableCell>

                <TableCell>
                  {catalog.pdfUrl ? (
                    <Button nativeButton={false} size="sm" variant="outline" render={<a href={catalog.pdfUrl} target="_blank" rel="noreferrer" />}>
                      <ExternalLink />Open PDF
                    </Button>
                  ) : (
                    <Badge variant="secondary">No PDF</Badge>
                  )}
                </TableCell>

                <TableCell className="pr-4 text-right text-sm text-muted-foreground">
                  {formatCatalogDate(catalog.priceDate)}
                </TableCell>
              </TableRow>
            ))}

            {!filtered.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No catalogs match the current filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <TablePagination
        page={currentPage}
        pageCount={pageCount}
        start={visibleCatalogs.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}
        end={Math.min(currentPage * PAGE_SIZE, filtered.length)}
        total={filtered.length}
        itemLabel="catalogs"
        onPrevious={() => setPage(currentPage - 1)}
        onNext={() => setPage(currentPage + 1)}
        onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
