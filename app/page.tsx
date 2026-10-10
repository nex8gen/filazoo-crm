import { BellRing, Building2, Mail, MessageSquareReply } from "lucide-react";
import { AddCompanyButton } from "@/components/crm-action-dialogs";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireWorkspaceMember } from "@/lib/auth";
import { getDashboardData } from "@/lib/data/crm";

const statIcons = [Building2, Mail, MessageSquareReply, BellRing];

export default async function DashboardPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const data = await getDashboardData();
  const stats = [
    { label: "Companies", value: data.companies.length, detail: "in Supabase" },
    { label: "Emails sent", value: data.sentCount, detail: `${data.emailQueueCount} queued` },
    { label: "Replies", value: data.replyCount, detail: "received emails" },
    { label: "Big-order alerts", value: data.bigOrderCount, detail: "active opportunities" },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="A concise view of prospecting activity, outreach performance, and high-value opportunities."
        actions={<AddCompanyButton canWrite={viewer.role !== "viewer"} />}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = statIcons[index];
          return (
            <Card key={stat.label} className="shadow-none">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription className="text-xs">{stat.label}</CardDescription>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-2xl font-semibold tracking-tight">{stat.value.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{stat.detail}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div><CardTitle className="text-sm font-medium">Recent activity</CardTitle><CardDescription className="text-xs">Latest events recorded in Supabase</CardDescription></div>
              <Badge variant="outline">{data.mode === "live" ? "Live" : "Setup required"}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {data.activity.length === 0 ? (
              <EmptyState title="No activity yet" description="CRM events will appear here after you add companies and start outreach." />
            ) : (
              <div className="space-y-1">
                {data.activity.map((item) => (
                  <div key={`${item.title}-${item.time}`} className="flex items-start justify-between gap-4 rounded-lg p-3 hover:bg-muted">
                    <div><p className="text-sm font-medium capitalize">{item.title}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.time}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader><CardTitle className="text-sm font-medium">Priority companies</CardTitle><CardDescription className="text-xs">Highest-fit active prospects</CardDescription></CardHeader>
          <CardContent className="space-y-1">
            {data.companies.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No companies in Supabase yet.</p>
            ) : data.companies.slice().sort((a, b) => b.fitScore - a.fitScore).slice(0, 5).map((company) => (
              <div key={company.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted text-xs font-medium">{company.initials}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{company.name}</p><p className="truncate text-xs text-muted-foreground">{company.country} · {company.segment}</p></div>
                <span className="text-xs font-medium text-primary">{company.fitScore}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
