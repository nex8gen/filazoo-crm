"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/language-provider";

/** Shared invoice-style footer. Pages are one-based; empty lists stay on page 1. */
export function TablePagination({ page, pageCount, total, itemLabel, onPrevious, onNext, disabled = false, className }: {
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
  const safePageCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(1, page), safePageCount);
  return (
    <div data-slot="table-pagination" className={cn("crm-table-pagination", className)}>
      <p className="text-muted-foreground" aria-live="polite">{t(`Page ${safePage} · ${total} ${itemLabel}`)}</p>
      <nav className="flex gap-2" aria-label={`${itemLabel} pagination`}>
        <Button type="button" variant="outline" disabled={disabled || safePage <= 1 || total === 0} onClick={onPrevious}>Previous</Button>
        <Button type="button" variant="outline" disabled={disabled || safePage >= safePageCount || total === 0} onClick={onNext}>Next</Button>
      </nav>
    </div>
  );
}
