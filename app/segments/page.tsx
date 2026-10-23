import Link from "next/link";
import { ArrowRight, Tags } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";

export default async function SegmentsPage() {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { companies } = await listCompanies();
  const counts = new Map<string, number>();
  for (const company of companies) {
    counts.set(company.segment, (counts.get(company.segment) ?? 0) + 1);
  }
  const segments = [...counts].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <PageHeader title="Segments" description="Browse your companies by business segment." />
      {segments.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {segments.map(([segment, count]) => (
            <li key={segment}>
              <Link href={`/companies?segment=${encodeURIComponent(segment)}`} className="flex h-full items-center gap-3 rounded-lg border bg-card p-5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <Tags className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-sm font-medium">{segment}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{count} {count === 1 ? "company" : "companies"}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No segments yet" description="Segments will appear here as companies are added." icon={Tags} />}
    </div>
  );
}
