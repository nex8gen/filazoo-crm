"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";

/** Filter controls update their state directly; Enter never navigates or submits a write. */
export function TableFilters({ children, actions }: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return <div className="crm-table-filter-bar">
    <form className="crm-table-filters" onSubmit={(event) => event.preventDefault()}>
      {children}
    </form>
    {actions ? <div className="flex flex-wrap items-end gap-2">{actions}</div> : null}
  </div>;
}

export function TableFilter({ label, children, search = false }: { label: string; children: ReactNode; search?: boolean }) {
  return <label className={search ? "crm-table-filter crm-table-filter-search" : "crm-table-filter"}><span className="sr-only">{label}</span><span className="crm-table-filter-control">{search ? <Search className="crm-table-search-icon" aria-hidden /> : null}{children}</span></label>;
}
