"use client";
import Link from "next/link";
import { quotationLabel, quotationStatusLabels, quotationToday } from "@/lib/quotations";
import { Library } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import { useLanguage } from "@/components/language-provider";
import type { AppLanguage } from "@/lib/i18n";
import { useMemo } from "react";
import { useWorkspaceState } from "@/components/workspace-memory";
import { filterCompanyCatalogs } from "@/lib/company-catalogs";
import type { Catalog } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { CompanyCatalogPdfActions } from "@/components/company-catalog-pdf-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilters, TableFilter } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePreferences } from "@/components/preferences-provider";

function formatCatalogDate(value: string, language: AppLanguage) {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(value));
}

export function CompanyCatalogsTable({ catalogs }: { catalogs: Catalog[] }) {
  const { preferences } = usePreferences();
  const PAGE_SIZE = preferences.tablePageSize;
  const { language } = useLanguage();
  const [query, setQuery] = useWorkspaceState("catalogs.query", "");
  const [currency, setCurrency] = useWorkspaceState("catalogs.currency", "all");
  const [draft, setDraft] = useWorkspaceState("catalogs.filters", { query: "", currency: "all" });
  const [page, setPage] = useWorkspaceState("catalogs.page", 1);

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
    <div className="space-y-6">
      <TableFilters onApply={() => { setQuery(draft.query); setCurrency(draft.currency); setPage(1); }}>
        <TableFilter label="Search quotations" search><Input value={draft.query} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="Company, SKU, or quotation reference" /></TableFilter>
        <TableFilter label="Currency"><Select value={draft.currency} onValueChange={(value) => setDraft({ ...draft, currency: value ?? "all" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All currencies</SelectItem>{currencies.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></TableFilter>
      </TableFilters>

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
                    <p className="mt-1 text-xs text-muted-foreground">{quotationLabel(catalog)}</p>
                    <Link href={`/company-quotations/${catalog.id}`} className="mt-2 inline-block text-sm text-primary underline">{language === "zh-CN" ? "打开报价" : "Open quotation"}</Link>
                    <p className="mt-1 text-xs text-muted-foreground">{(() => { const status = catalog.quoteOrderId ? "converted" : catalog.quoteStatus === "shared" && catalog.quoteValidUntil && catalog.quoteValidUntil < quotationToday() ? "expired" : catalog.quoteStatus ?? "draft"; const zh = { draft: "草稿", shared: "已分享", accepted: "已接受", declined: "已拒绝", cancelled: "已取消", superseded: "已有新版本", expired: "已过期", converted: "已创建订单" }; return language === "zh-CN" ? zh[status] : quotationStatusLabels[status]; })()}</p>
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
                          <span key={`${catalog.id}-${sku}`} className="rounded-md border bg-muted/40 px-2 py-1 text-xs font-mono">
                            {sku}
                          </span>
                        ))}
                        {catalog.productSkus.length > 4 ? (
                          <span className="self-center text-xs text-muted-foreground">+{catalog.productSkus.length - 4} more</span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Empty catalog shell</p>
                    )}
                  </div>
                </TableCell>

                <TableCell>
                  {catalog.quoteValidUntil ? <div className="flex flex-wrap gap-3 text-sm text-primary underline"><a href={`/api/catalogs/${catalog.id}/quotation/pdf`} target="_blank" rel="noreferrer">{language === "zh-CN" ? "预览报价" : "Preview quotation"}</a><a href={`/api/catalogs/${catalog.id}/quotation/pdf?download=1`}>{language === "zh-CN" ? "下载报价" : "Download quotation"}</a></div> : <CompanyCatalogPdfActions catalog={catalog} />}
                  {catalog.pdfUrl && !catalog.pdfUrl.startsWith("/api/catalogs/") ? <a className="mt-2 block text-xs text-primary underline" href={catalog.pdfUrl} target="_blank" rel="noreferrer">Original PDF</a> : null}
                </TableCell>

                <TableCell className="pr-4 text-right text-sm text-muted-foreground">
                  {formatCatalogDate(catalog.priceDate, language)}
                </TableCell>
              </TableRow>
            ))}

            {!filtered.length ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  <EmptyState compact icon={Library} title="No catalogs match the current filters." description="Try another search or adjust your filters." className="border-0 bg-transparent" />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        
      </Card>
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
    </div>
  );
}
