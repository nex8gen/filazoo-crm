"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Draft filters are committed together, including when the user presses Enter. */
export function TableFilters({ children, onApply, disabled = false, actions }: {
  children: ReactNode;
  onApply: () => void;
  disabled?: boolean;
  actions?: ReactNode;
}) {
  return <div className="crm-table-filter-bar">
    <form className="crm-table-filters" onSubmit={(event) => { event.preventDefault(); onApply(); }}>
      {children}
      <Button type="submit" variant="outline" disabled={disabled}><Search />Apply</Button>
    </form>
    {actions ? <div className="flex flex-wrap items-end gap-2">{actions}</div> : null}
  </div>;
}

export function TableFilter({ label, children, search = false }: { label: string; children: ReactNode; search?: boolean }) {
  return <label className={search ? "crm-table-filter crm-table-filter-search" : "crm-table-filter"}>{label}{children}</label>;
}
