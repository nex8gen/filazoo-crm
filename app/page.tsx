import { ArrowUpRight, BellRing, Building2, Mail, MessageSquareReply, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { companies, dashboardStats, weeklyActivity } from "@/lib/fake-data";

const statIcons = [Building2, Mail, MessageSquareReply, BellRing];

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="A concise view of prospecting activity, outreach performance, and high-value opportunities."
        actions={<Button size="sm"><Plus /> Add company</Button>}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((stat, index) => {
          const Icon = statIcons[index];
          return (
            <Card key={stat.label} className="shadow-none">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription className="text-xs">{stat.label}</CardDescription>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-2xl font-semibold tracking-tight">{stat.value}</p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowUpRight className="size-3 text-primary" />{stat.change}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="shadow-none lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div><CardTitle className="text-sm font-medium">Outreach activity</CardTitle><CardDescription className="text-xs">Messages sent across the last 12 weeks</CardDescription></div>
              <Badge variant="outline">Last 12 weeks</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex h-64 items-end gap-2 border-b border-l p-4">
              {weeklyActivity.map((value, index) => (
                <div key={index} className="flex h-full flex-1 items-end">
                  <div className="w-full rounded-t-sm bg-primary/20 transition-colors duration-150 hover:bg-primary" style={{ height: `${value * 2}%` }} aria-label={`${value} messages`} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>12 weeks ago</span><span>This week</span></div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader><CardTitle className="text-sm font-medium">Priority companies</CardTitle><CardDescription className="text-xs">Highest-fit active prospects</CardDescription></CardHeader>
          <CardContent className="space-y-1">
            {companies.slice(0, 5).map((company) => (
              <div key={company.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted text-xs font-medium">{company.name.slice(0, 2).toUpperCase()}</div>
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
