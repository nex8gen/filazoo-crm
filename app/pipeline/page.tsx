import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { companies } from "@/lib/mock-data";
import { pipelineStages } from "@/lib/types";

export const metadata={title:"Pipeline"};
export default function PipelinePage(){const stages=pipelineStages.slice(0,6);return <><PageHeader title="Pipeline" description="Move prospects from first discovery to a lasting wholesale relationship." action={<button className="button button-outline">Customize stages</button>}/><div className="kanban">{stages.map(stage=>{const cards=companies.filter(c=>c.stage===stage);return <section className="kanban-column" key={stage}><header><span><i className={`stage-dot stage-${stage.toLowerCase().replaceAll(" ","-")}`}/>{stage}</span><small>{cards.length}</small></header><div className="kanban-stack">{cards.map(c=><Link href={`/companies/${c.id}`} className="kanban-card" key={c.id}><div><span className="company-avatar">{c.initials}</span><strong>{c.name}</strong></div><p>{c.segment} · {c.country}</p><div className="kanban-meta"><span>Fit {c.fitScore}/10</span><span>{c.nextAction}</span></div></Link>)}{cards.length===0&&<div className="empty-column">No companies</div>}</div></section>})}</div></>}
