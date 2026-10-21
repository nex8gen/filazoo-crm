"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TablePagination({
  page,
  pageCount,
  start,
  end,
  total,
  itemLabel,
  onPrevious,
  onNext,
  onPageChange,
  className,
  previousIcon: PreviousIcon = ChevronLeft,
  nextIcon: NextIcon = ChevronRight,
}: {
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
  itemLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onPageChange: (page: number) => void;
  className?: string;
  previousIcon?: LucideIcon;
  nextIcon?: LucideIcon;
}) {
  const footerRef = useRef<HTMLDivElement>(null);
  const safePageCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(1, page), safePageCount);
  const safeStart = total > 0 ? Math.max(1, Math.min(start, total)) : 0;
  const safeEnd = total > 0 ? Math.max(safeStart, Math.min(end, total)) : 0;
  const pageNumbers = Array.from({ length: Math.min(5, safePageCount) }, (_, index) => {
    const firstPage = Math.min(Math.max(1, safePage - 2), Math.max(1, safePageCount - 4));
    return firstPage + index;
  });

  function changePage(action: () => void) {
    action();
    requestAnimationFrame(() => {
      const scope = footerRef.current?.parentElement;
      scope?.querySelector<HTMLElement>(".crm-table-viewport")?.scrollTo({ top: 0 });
    });
  }

  return (
    <div
      ref={footerRef}
      data-slot="table-pagination"
      className={cn(
        "sticky bottom-0 z-20 flex min-h-14 w-full shrink-0 flex-wrap items-center justify-between gap-3 border-y bg-background px-4 py-3 text-xs text-muted-foreground shadow-[0_-1px_0_0_var(--border)]",
        className,
      )}
    >
      <p aria-live="polite">Showing {safeStart}–{safeEnd} of {total} {itemLabel}</p>
      <nav className="flex items-center gap-1" aria-label={`${itemLabel} pagination`}>
        <Button variant="outline" size="icon-sm" disabled={safePage <= 1 || total === 0} onClick={() => changePage(onPrevious)} aria-label="Previous page">
          <PreviousIcon />
        </Button>
        <div className="flex items-center gap-1" aria-label={`Page ${safePage} of ${safePageCount}`}>
          {pageNumbers.map((pageNumber) => (
            <Button
              key={pageNumber}
              variant={pageNumber === safePage ? "secondary" : "ghost"}
              size="icon-sm"
              className="tabular-nums"
              disabled={total === 0}
              aria-current={pageNumber === safePage ? "page" : undefined}
              aria-label={`Go to page ${pageNumber}`}
              onClick={() => changePage(() => onPageChange(pageNumber))}
            >
              {pageNumber}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="icon-sm" disabled={safePage >= safePageCount || total === 0} onClick={() => changePage(onNext)} aria-label="Next page">
          <NextIcon />
        </Button>
      </nav>
    </div>
  );
}
