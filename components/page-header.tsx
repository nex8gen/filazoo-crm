"use client";

import { createContext, useContext, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";

const PageHeaderContext = createContext<{
  detailsHost: HTMLDivElement | null;
  setDetailsHost: (node: HTMLDivElement | null) => void;
  actionsHost: HTMLDivElement | null;
  setActionsHost: (node: HTMLDivElement | null) => void;
} | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [detailsHost, setDetailsHost] = useState<HTMLDivElement | null>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ detailsHost, setDetailsHost, actionsHost, setActionsHost }), [detailsHost, actionsHost]);
  return <PageHeaderContext value={value}>{children}</PageHeaderContext>;
}

export function PageHeader({ title, icon: Icon }: {
  title: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const header = useContext(PageHeaderContext);
  return (
    <header className="workspace-page-header flex min-h-13 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-background px-5 py-2 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon aria-hidden className="size-4 shrink-0" />
        <h1 className="truncate text-sm font-medium leading-5">{title}</h1>
      </div>
      <div ref={header?.setDetailsHost} className="order-last min-w-0 max-w-full flex-1 basis-full empty:hidden sm:order-none sm:basis-0" />
      <div ref={header?.setActionsHost} className="ml-auto min-w-0 max-w-full empty:hidden" />
    </header>
  );
}

/** Show page-specific context directly beside the title. */
export function PageHeaderDetails({ children }: { children: ReactNode }) {
  const header = useContext(PageHeaderContext);
  if (!header) return <div className="min-w-0 border-b p-3">{children}</div>;
  return header.detailsHost ? createPortal(children, header.detailsHost) : null;
}

/** Keep page commands on the title row without coupling them to the shell. */
export function PageActions({ children }: { children: ReactNode }) {
  const header = useContext(PageHeaderContext);
  const actions = <div role="group" aria-label="Page actions" className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{children}</div>;
  if (!header) return <div className="mb-3">{actions}</div>;
  return header.actionsHost ? createPortal(actions, header.actionsHost) : null;
}
