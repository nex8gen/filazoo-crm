"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardList, House, Mail, Maximize2, ShieldCheck, Workflow } from "lucide-react";
import styles from "./crm-product-tour.module.css";

const views = [
  { id: "home", label: "Home", icon: House },
  { id: "email", label: "Email", icon: Mail },
  { id: "workflow", label: "Workflow", icon: Workflow },
  { id: "orders", label: "Purchase Order", icon: ClipboardList },
] as const;
type View = typeof views[number]["id"];

export function CrmProductTour({ compact = false }: { compact?: boolean }) {
  const [view, setView] = useState<View>("home");
  const [expanded, setExpanded] = useState(false);
  const [scale, setScale] = useState(0.875);
  const viewport = useRef<HTMLDivElement>(null);
  const selected = views.find(item => item.id === view)!;
  const url = `/marketing/crm-demo/${view}.html`;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / 1280));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div className={styles.frame}>
    <div className={styles.browserBar}><span className={styles.dots} aria-hidden="true"><i /><i /><i /></span><span><ShieldCheck size={13} />app.newai.xin</span><span className={styles.sampleLabel}>Actual CRM · Demo data</span></div>
    <div className={styles.toolbar}><div role="tablist" aria-label="Explore the actual NewAI CRM">{views.map(({ id, label, icon: Icon }, index) => <button key={id} type="button" id={`crm-tour-${id}`} role="tab" aria-selected={view === id} aria-controls="crm-tour-preview" tabIndex={view === id ? 0 : -1} onClick={() => { setView(id); if (compact) setExpanded(true); }} onKeyDown={event => {
      let next: number;
      if (event.key === "ArrowRight") next = (index + 1) % views.length;
      else if (event.key === "ArrowLeft") next = (index + views.length - 1) % views.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = views.length - 1;
      else return;
      event.preventDefault();
      setView(views[next].id);
      if (compact) setExpanded(true);
      document.getElementById(`crm-tour-${views[next].id}`)?.focus();
    }}><Icon size={15} />{label}</button>)}</div><a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open full-size ${selected.label} demo in a new tab`}><Maximize2 size={14} /><span>Full-size preview</span></a></div>
    <div ref={viewport} className={`${styles.viewport} ${compact && !expanded ? styles.compactViewport : ""}`} id="crm-tour-preview" role="tabpanel" aria-labelledby={`crm-tour-${view}`}>
      <iframe key={view} src={url} title={`Actual NewAI CRM ${selected.label} interface with synthetic demo data`} sandbox="allow-same-origin" tabIndex={-1} className={styles.preview} width={1280} height={800} style={{ transform: `scale(${scale})` }} />
    </div>
    <div className={styles.caption}><ShieldCheck size={13} /><span>Your actual CRM. Demo data. Read-only.</span>{compact && <button type="button" aria-expanded={expanded} aria-controls="crm-tour-preview" onClick={() => setExpanded(value => !value)}>{expanded ? "Compact preview" : "Show full preview"}</button>}</div>
  </div>;
}
