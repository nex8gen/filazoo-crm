"use client";
import { Building2, ClipboardList, LoaderCircle, Package2, ReceiptText, Search, Truck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { isWorkspaceSearchResponse, normalizeWorkspaceSearch, validWorkspaceSearch, workspaceSearchKinds, workspaceSearchLabels, workspaceSearchDetail, type WorkspaceSearchKind, type WorkspaceSearchResponse } from "@/lib/workspace-search";

import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type CommandNavigationItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type CommandNavigationGroup = {
  label: string;
  items: CommandNavigationItem[];
};

export function WorkspaceCommandMenu({ navigation, open, onOpenChange, onNavigate }: {
  navigation: CommandNavigationGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (href: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState<{ query: string; data?: WorkspaceSearchResponse; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { t } = useLanguage();
  const text = normalizeWorkspaceSearch(query);
  const valid = validWorkspaceSearch(text);
  useEffect(() => {
    if (!open || !valid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/workspace/search?q=${encodeURIComponent(text)}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        });
        const result: unknown = await response.json();
        if (!response.ok || !isWorkspaceSearchResponse(result) || result.query !== text) throw new Error(response.status === 401 ? "Sign in again to search CRM records." : "Record search is temporarily unavailable.");
        if (!controller.signal.aborted) setReply({ query: text, data: result });
      } catch (error) {
        if (!controller.signal.aborted) setReply({ query: text, error: error instanceof Error && error.message === "Sign in again to search CRM records." ? error.message : "Record search is temporarily unavailable." });
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, valid, text, attempt]);
  const current = reply?.query === text ? reply : null;
  const loading = valid && !current;
  const groups = navigation.map(group => ({ ...group, items: group.items.filter(item => `${t(group.label)} ${t(item.label)} ${group.label} ${item.label}`.toLocaleLowerCase().includes(text.toLocaleLowerCase())) })).filter(group => group.items.length);
  const icons: Record<WorkspaceSearchKind, typeof Search> = { company: Building2, contact: UserRound, invoice: ReceiptText, order: ClipboardList, product: Package2, task: ClipboardList, shipment: Truck };
  return (
    <CommandDialog title="Search workspace" description="Find CRM records and pages." open={open} onOpenChange={onOpenChange} commandProps={{ shouldFilter: false }} className="top-[12%] max-h-[80svh] translate-y-0 sm:max-w-xl">
      <CommandInput placeholder="Search companies, email, invoice or PO number" aria-label="Search CRM records and pages" value={query} onValueChange={setQuery} maxLength={120} />
      <div role="status" aria-live="polite" className="flex min-h-10 items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        {loading ? <><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /><span>Searching CRM records...</span></> : !valid ? <><Search className="size-3.5" aria-hidden="true" /><span>{text.includes("*") ? "Wildcard searches are not supported." : "Enter at least 2 characters to search CRM records."}</span></> : current?.error ? <span>{current.error}</span> : <span>Top matches, up to 6 per record type.</span>}
      </div>
      {current?.data?.unavailable.length ? <div role="alert" className="border-b px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400"><p>Some record types could not be searched.</p><p>{current.data.unavailable.map(kind => t(workspaceSearchLabels[kind])).join(" · ")}</p></div> : null}
      {current?.error || current?.data?.unavailable.length ? <button type="button" className="px-3 py-2 text-left text-xs font-medium text-primary underline" onClick={() => { setReply(null); setAttempt(value => value + 1); }}>Retry record search</button> : null}
      <CommandList className="max-h-[55svh]" aria-label="Workspace search results">
        {current?.data ? workspaceSearchKinds.map(kind => {
          const items = current.data!.results.filter(result => result.kind === kind);
          if (!items.length) return null;
          const Icon = icons[kind];
          return <CommandGroup key={kind} heading={t(workspaceSearchLabels[kind])}>{items.map(result => <CommandItem key={`${kind}:${result.id}`} value={`${kind}:${result.id}`} onSelect={() => onNavigate(result.href)} className="items-start gap-3 py-2.5"><Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span data-no-translate className="block truncate font-medium">{result.title}</span><span data-no-translate className="mt-0.5 block truncate text-xs text-muted-foreground">{workspaceSearchDetail(result, t)}</span></span></CommandItem>)}</CommandGroup>;
        }) : null}
        {valid && current?.data && !current.data.results.length && !current.data.unavailable.length ? <p className="px-4 py-6 text-center text-xs text-muted-foreground">No CRM records match your search.</p> : null}
        {groups.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item, index) => (
              <CommandItem key={item.href} value={`${group.label} ${item.label}`} onSelect={() => onNavigate(item.href)}>
                <item.icon /><span>{item.label}</span><CommandShortcut>{index + 1}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <p className="border-t px-3 py-2 text-[11px] leading-5 text-muted-foreground">Search company names, contact emails, invoice numbers, PO references, product names, tasks and tracking numbers. Results follow your workspace access.</p>
    </CommandDialog>
  );
}
