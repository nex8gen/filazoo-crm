"use client";

import { useState } from "react";
import { Filter, Search } from "lucide-react";
import { AddOpportunityButton } from "@/components/crm-action-dialogs";
import { KanbanBoard } from "@/components/kanban-board";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Company } from "@/lib/types";

export function PipelineWorkspace({ companies, canWrite }: { companies: Company[]; canWrite: boolean }) {
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const filtering = Boolean(query || stage !== "all");

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Move qualified companies through the outreach journey and keep high-value opportunities visible."
        actions={<><Button size="sm" variant={filtering ? "secondary" : "outline"} onClick={() => setShowFilters((value) => !value)}><Filter />Filter{filtering ? " active" : ""}</Button><AddOpportunityButton companies={companies} canWrite={canWrite} /></>}
      />
      {showFilters ? <div className="mb-4 flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or country" /></div>
        <Select value={stage} onValueChange={(value) => setStage(value ?? "all")}><SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All stages</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="contacted">Contacted</SelectItem><SelectItem value="replied">Replied</SelectItem><SelectItem value="interested">Interested</SelectItem><SelectItem value="big_order">Big order</SelectItem><SelectItem value="won">Won</SelectItem><SelectItem value="lost">Lost</SelectItem></SelectContent></Select>
        {filtering ? <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setStage("all"); }}>Clear</Button> : null}
      </div> : null}
      <KanbanBoard companies={companies} canWrite={canWrite} query={query} stageFilter={stage} />
    </div>
  );
}
