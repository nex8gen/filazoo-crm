import Link from "next/link";
import { ActivityFeed, MetricCard, PageHeader, ProgressBar, SectionCard, StatusPill } from "@/components/ui";
import { companies, dashboardMetrics, recentActivity } from "@/lib/mock-data";

export default function DashboardPage() {
  const priority = companies.filter((company) => company.fitScore >= 8).slice(0, 4);
  return <>
    <PageHeader eyebrow="Thursday, 8 October" title="Good morning, Filazoo" description="Your B2B pipeline is healthy. Four high-fit prospects need attention today." action={<Link className="button button-primary" href="/companies">Add company <span aria-hidden>+</span></Link>} />
    <section className="metric-grid" aria-label="Business overview">{dashboardMetrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
    <section className="dashboard-grid">
      <SectionCard className="span-2" title="Pipeline overview" subtitle="Lead movement across the last 30 days" action={<Link className="text-link" href="/pipeline">View pipeline →</Link>}>
        <div className="pipeline-summary">{[["New",184,100,"blue"],["Contacted",96,71,"violet"],["Replied",38,44,"amber"],["Interested",17,28,"green"],["Won",6,14,"dark"]].map(([label,count,value,tone]) => <div className="pipeline-row" key={label}><div className="pipeline-label"><span>{label}</span><strong>{count}</strong></div><ProgressBar value={Number(value)} tone={String(tone)} /></div>)}</div>
        <div className="conversion-callout"><span className="callout-icon">↗</span><div><strong>9.2% reply rate</strong><p>Up 1.4% from your previous campaign</p></div><span className="positive">+18%</span></div>
      </SectionCard>
      <SectionCard title="Recent activity" subtitle="Latest updates across the CRM"><ActivityFeed items={recentActivity} /><Link className="button button-quiet full-width" href="/emails">See all activity</Link></SectionCard>
      <SectionCard className="span-3" title="Priority prospects" subtitle="High-fit companies requiring your attention" action={<Link className="text-link" href="/companies">View all companies →</Link>}>
        <div className="table-wrap"><table><thead><tr><th>Company</th><th>Segment</th><th>Country</th><th>Fit score</th><th>Stage</th><th>Next action</th></tr></thead><tbody>{priority.map((company) => <tr key={company.id}><td><Link className="company-cell" href={`/companies/${company.id}`}><span className="company-avatar">{company.initials}</span><span><strong>{company.name}</strong><small>{company.domain}</small></span></Link></td><td>{company.segment}</td><td>{company.country}</td><td><span className="score"><i style={{ "--score": `${company.fitScore * 10}%` } as React.CSSProperties} />{company.fitScore}/10</span></td><td><StatusPill value={company.stage} /></td><td><span className="next-action">{company.nextAction}</span></td></tr>)}</tbody></table></div>
      </SectionCard>
    </section>
  </>;
}
