"use client";
import { Columns3, Users } from "lucide-react";

import { EmptyState } from "@/components/data-state";
import { useWorkspaceState } from "@/components/workspace-memory";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilters, TableFilter } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePreferences } from "@/components/preferences-provider";

type Lead = {
  leadgen_id: string;
  company_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  form_id: string | null;
  ad_id: string | null;
  created_at: string;
  owner: string;
};

const submittedFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" });

export function MetaLeadsTable({ leads }: { leads: Lead[] }) {
  const { preferences } = usePreferences();
  const pageSize = preferences.tablePageSize;
  const [search, setSearch] = useWorkspaceState("meta-leads.search", "");
  const [query, setQuery] = useWorkspaceState("meta-leads.query", "");
  const [page, setPage] = useWorkspaceState("meta-leads.page", 1);
  const [showSourceIds, setShowSourceIds] = useWorkspaceState("meta-leads.source-ids", false);
  const filtered = leads.filter((lead) => [lead.full_name, lead.email, lead.phone, lead.owner, lead.form_id, lead.ad_id].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return <div className="space-y-6">
    <TableFilters onApply={() => { setQuery(search); setPage(1); }} actions={<DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}><Columns3 />Columns</DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuLabel>Source details</DropdownMenuLabel><DropdownMenuCheckboxItem checked={showSourceIds} onCheckedChange={setShowSourceIds}>Form / ad IDs</DropdownMenuCheckboxItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}><TableFilter label="Search submission" search><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, phone, owner, form, or ad" /></TableFilter></TableFilters>
    <div className="crm-table-frame"><Table>
      <caption className="sr-only">Latest 100 Meta form submissions</caption>
      <TableHeader><TableRow>{["Name", "Email", "Phone", "Assigned manager", ...(showSourceIds ? ["Form / ad IDs"] : []), "Submitted"].map((label) => <TableHead key={label} scope="col" title={label === "Submitted" ? "Asia/Shanghai" : undefined}>{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((lead) => <TableRow key={lead.leadgen_id}>
        <TableCell>{lead.company_id ? <Link href={`/companies/${lead.company_id}`} className="font-semibold text-primary underline-offset-4 hover:underline">{lead.full_name || "Name not provided"}</Link> : lead.full_name || "Name not provided"}</TableCell>
        <TableCell>{lead.email ? <a href={`mailto:${encodeURIComponent(lead.email)}`} className="hover:underline">{lead.email}</a> : "—"}</TableCell><TableCell>{lead.phone ? <a href={`tel:${encodeURIComponent(lead.phone)}`} className="hover:underline">{lead.phone}</a> : "—"}</TableCell><TableCell>{lead.owner}</TableCell>{showSourceIds ? <TableCell className="font-mono text-xs">{lead.form_id || "—"} / {lead.ad_id || "—"}</TableCell> : null}<TableCell><time dateTime={lead.created_at} title="Asia/Shanghai">{submittedFormatter.format(new Date(lead.created_at))}</time></TableCell>
      </TableRow>)}{!rows.length ? <TableRow><TableCell colSpan={showSourceIds ? 6 : 5} className="h-32 text-center text-muted-foreground"><EmptyState compact icon={Users} title={query ? "No submissions match your search." : "No Meta leads received yet."} className="border-0 bg-transparent" /></TableCell></TableRow> : null}</TableBody>
    </Table></div>
    <TablePagination page={currentPage} pageCount={pageCount} start={rows.length ? (currentPage - 1) * pageSize + 1 : 0} end={Math.min(currentPage * pageSize, filtered.length)} total={filtered.length} itemLabel="submissions" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
  </div>;
}
