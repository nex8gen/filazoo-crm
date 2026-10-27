"use client";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/data-state";
import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
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

export function MetaLeadsTable({ leads }: { leads: Lead[] }) {
  const { preferences } = usePreferences();
  const pageSize = preferences.tablePageSize;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = leads.filter((lead) => [lead.full_name, lead.email, lead.phone, lead.owner, lead.form_id, lead.ad_id].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return <div className="space-y-6">
    <TableFilters onApply={() => { setQuery(search); setPage(1); }}><TableFilter label="Search submission" search><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, phone, owner, form, or ad" /></TableFilter></TableFilters>
    <div className="crm-table-frame"><Table>
      <caption className="sr-only">Latest 100 Meta form submissions</caption>
      <TableHeader><TableRow>{["Name", "Email", "Phone", "Owner", "Form / Ad", "Submitted (UTC)"].map((label) => <TableHead key={label} scope="col">{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((lead) => <TableRow key={lead.leadgen_id}>
        <TableCell>{lead.company_id ? <Link href={`/companies/${lead.company_id}`} className="font-semibold text-primary underline-offset-4 hover:underline">{lead.full_name || "Name not provided"}</Link> : lead.full_name || "Name not provided"}</TableCell>
        <TableCell>{lead.email || "—"}</TableCell><TableCell>{lead.phone || "—"}</TableCell><TableCell>{lead.owner}</TableCell><TableCell>{lead.form_id || "—"} / {lead.ad_id || "—"}</TableCell><TableCell>{new Date(lead.created_at).toISOString().replace("T", " ").slice(0, 19)}</TableCell>
      </TableRow>)}{!rows.length ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground"><EmptyState compact icon={Users} title={query ? "No submissions match your search." : "No Meta leads received yet."} className="border-0 bg-transparent" /></TableCell></TableRow> : null}</TableBody>
    </Table></div>
    <TablePagination page={currentPage} pageCount={pageCount} total={filtered.length} itemLabel="submissions" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} />
  </div>;
}
