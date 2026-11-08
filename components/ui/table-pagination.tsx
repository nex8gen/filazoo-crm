"use client";

import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/language-provider";
import { tablePaginationState } from "@/lib/table-pagination";

/** Pages are one-based; empty lists stay on page 1. */
export function TablePagination({ page, pageCount, total, start, end, itemLabel, onPrevious, onNext, onPageChange, previousIcon: PreviousIcon = ChevronLeft, nextIcon: NextIcon = ChevronRight, disabled = false, className }: {
  page: number;
  pageCount: number;
  total: number;
  itemLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
  className?: string;
  start?: number;
  end?: number;
  onPageChange?: (page: number) => void;
  previousIcon?: LucideIcon;
  nextIcon?: LucideIcon;
}) {
  const { t } = useLanguage();
  const state = tablePaginationState(page, pageCount, total, start, end);
  const range = !state.total ? "0–0" : state.hasRange ? `${state.start}–${state.end}` : `${state.page} / ${state.pages}`;
  return (
    <div data-slot="table-pagination" className={cn("crm-table-pagination", className)}>
      <nav className="crm-table-page-controls" aria-label={`${itemLabel} pagination`}>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("Previous page")} title={t("Previous page")} disabled={disabled || !state.canPrevious} onClick={() => onPageChange ? onPageChange(state.page - 1) : onPrevious()}><PreviousIcon className="size-4" /></Button>
        <span aria-hidden="true" className="tabular-nums">{range}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("Next page")} title={t("Next page")} disabled={disabled || !state.canNext} onClick={() => onPageChange ? onPageChange(state.page + 1) : onNext()}><NextIcon className="size-4" /></Button>
      </nav>
      <p aria-live="polite"><span className="sr-only">{t(`Page ${state.page} of ${state.pages}`)} · </span>{t(`${state.total} ${itemLabel}`)}</p>
    </div>
  );
}
