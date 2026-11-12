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
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilters, TableFilter } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePreferences } from "@/components/preferences-provider";

function formatCatalogDate(value: string, language: AppLanguage) {
  return new Intl.DateTimeFormat(language, { timeZone: "Asia/Shanghai", dateStyle: "medium" }).format(new Date(value));
}

export function CompanyCatalogsTable({ catalogs }: { catalogs: Catalog[] }) {
  const { preferences } = usePreferences();
  const PAGE_SIZE = preferences.tablePageSize;
  const { language } = useLanguage();
  const [query, setQuery] = useWorkspaceState("catalogs.query", "");
  const [currency, setCurrency] = useWorkspaceState("catalogs.currency", "all");
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
      <TableFilters>
        <TableFilter label="Search quotations" search><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Company, SKU, or quotation reference" /></TableFilter>
        <TableFilter label="Currency"><Select value={currency} onValueChange={(value) => { setCurrency(value ?? "all"); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All currencies</SelectItem>{currencies.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></TableFilter>
      </TableFilters>

      <div className="crm-table-frame crm-table-page-wide">
        <Table>
          <caption className="sr-only">Customer quotations, validity, products, currencies, and PDF actions</caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Quotation</TableHead>
              <TableHead className="min-w-48">Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Products</TableHead>
              <TableHead>Price date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {visibleCatalogs.map((catalog) => (
              <TableRow key={catalog.id}>
                <TableCell><Link href={`/company-quotations/${catalog.id}`} className="font-medium hover:underline" aria-label={`${language === "zh-CN" ? "打开报价" : "Open quotation"} ${quotationLabel(catalog)}`}>{quotationLabel(catalog)}</Link></TableCell>
                <TableCell><span className="block max-w-64 truncate" title={catalog.company}>{catalog.company}</span></TableCell>
                <TableCell><Badge variant="secondary" title={catalog.quoteValidUntil ? `Valid until ${formatCatalogDate(catalog.quoteValidUntil, language)}` : undefined}>{(() => { const status = catalog.quoteOrderId ? "converted" : catalog.quoteStatus === "shared" && catalog.quoteValidUntil && catalog.quoteValidUntil < quotationToday() ? "expired" : catalog.quoteStatus ?? "draft"; const zh = { draft: "草稿", shared: "已分享", accepted: "已接受", declined: "已拒绝", cancelled: "已取消", superseded: "已有新版本", expired: "已过期", converted: "已创建订单" }; return language === "zh-CN" ? zh[status] : quotationStatusLabels[status]; })()}</Badge></TableCell>

                <TableCell>
                  {catalog.currency}
                </TableCell>

                <TableCell>
                  <span title={catalog.productSkus.join(", ")}>{catalog.productSkus.length} {catalog.productSkus.length === 1 ? "product" : "products"}</span>
                </TableCell>

                <TableCell><time dateTime={catalog.priceDate}>{formatCatalogDate(catalog.priceDate, language)}</time></TableCell>

                <TableCell>
                  {catalog.quoteValidUntil ? <div className="flex justify-end gap-3 text-xs text-primary underline"><a href={`/api/catalogs/${catalog.id}/quotation/pdf`} target="_blank" rel="noreferrer" aria-label={`Preview quotation ${quotationLabel(catalog)}`}>{language === "zh-CN" ? "预览" : "Preview"}</a><a href={`/api/catalogs/${catalog.id}/quotation/pdf?download=1`} aria-label={`Download quotation ${quotationLabel(catalog)}`}>{language === "zh-CN" ? "下载" : "Download"}</a></div> : <CompanyCatalogPdfActions catalog={catalog} />}
                  {catalog.pdfUrl && !catalog.pdfUrl.startsWith("/api/catalogs/") ? <a className="mt-2 block text-xs text-primary underline" href={catalog.pdfUrl} target="_blank" rel="noreferrer">Original PDF</a> : null}
                </TableCell>

              </TableRow>
            ))}

            {!filtered.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  <EmptyState compact icon={Library} title="No quotations match the current filters." description="Try another search or adjust your filters." className="border-0 bg-transparent" />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        
      </div>
<TablePagination
        page={currentPage}
        pageCount={pageCount}
        start={visibleCatalogs.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}
        end={Math.min(currentPage * PAGE_SIZE, filtered.length)}
        total={filtered.length}
        itemLabel="quotations"
        onPrevious={() => setPage(currentPage - 1)}
        onNext={() => setPage(currentPage + 1)}
        onPageChange={setPage}
        />
    </div>
  );
}
