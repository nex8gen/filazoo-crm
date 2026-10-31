"use client";

import { useMemo, useState } from "react";
import { FlaskConical, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { testFlowScenarios } from "@/lib/flow-scenarios";
import { stepLabels, type FlowInput } from "@/lib/flows";

const factLabels: Record<string, string> = { customerReplied: "Customer replied", openedEmail: "Opened email", clickedLink: "Clicked link", category: "Category", segment: "Segment", country: "Country", companyStatus: "Company status", fitScore: "Fit score" };

export function FlowScenarioLab({ flow, onOpenChange }: { flow: FlowInput; onOpenChange: (open: boolean) => void }) {
  const [selected, setSelected] = useState(0);
  const result = useMemo(() => {
    try { return { report: testFlowScenarios(flow), error: null }; }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : "Complete the workflow settings first." }; }
  }, [flow]);
  const report = result.report;
  const current = report?.cases[selected];
  return <Dialog open onOpenChange={onOpenChange}><DialogContent className="z-[70] max-h-[90vh] overflow-y-auto sm:max-w-5xl">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><FlaskConical className="size-5" />Test scenarios</DialogTitle><DialogDescription>Check branches, missing values, fit-score boundaries, replies and message filters using generated customer scenarios. No email is sent and no CRM record is changed.</DialogDescription></DialogHeader>
    {result.error ? <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{result.error}</p> : report ? <>
      <div className="grid grid-cols-3 gap-3">{[["Scenarios checked", report.cases.length], ["Actions reached", `${report.reachedActions} / ${report.actionCount}`], ["Paths reached", `${report.reachedPaths} / ${report.pathCount}`]].map(([label, value]) => <div key={label} className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div>
      <div className="rounded-lg bg-muted/50 p-3 text-xs leading-5">Includes simulated replies, opens and clicks after waits when relevant. These are test inputs. AI output, mailbox delivery and saved-customer eligibility require separate tests.{report.truncated ? ` Showing 256 of ${report.possible} input combinations; this is partial coverage.` : ""}</div>
      {report.uncoveredPaths.length ? <p className="flex items-start gap-2 rounded-lg border border-amber-300 p-3 text-sm"><AlertTriangle className="size-4 shrink-0" />Paths not reached: {report.uncoveredPaths.join(", ")}. Check overlapping rules, entry filters or add a custom scenario in Preview.</p> : <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" />Every configured path was reached by a generated scenario.</p>}
      <label className="grid gap-2 text-sm font-medium sm:hidden">Scenario<select className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{report.cases.map((item, index) => <option key={item.id} value={index}>Scenario {item.id}</option>)}</select></label>
      <div className="grid min-h-0 gap-4 sm:grid-cols-[240px_1fr]"><div className="hidden max-h-80 space-y-1 overflow-y-auto rounded-xl border p-2 sm:block" aria-label="Generated scenarios">{report.cases.map((item, index) => <Button key={item.id} variant={selected === index ? "secondary" : "ghost"} className="w-full justify-between" onClick={() => setSelected(index)} aria-pressed={selected === index}>Scenario {item.id}<span className="text-xs text-muted-foreground">{item.enters ? `${item.trace.length} events` : "Excluded"}</span></Button>)}</div><div className="max-h-96 space-y-4 overflow-y-auto rounded-xl border p-4" aria-live="polite">{current ? <><p className="text-sm font-semibold">Scenario {current.id}</p><dl className="grid grid-cols-2 gap-2 text-xs">{Object.entries(current.facts).filter(([key]) => key !== "pipelineStage").map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{factLabels[key] || key}</dt><dd>{value === null ? "Not set" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</dd></div>)}</dl>{current.afterWait ? <p className="rounded-lg bg-primary/5 p-3 text-xs">After wait {current.afterWait.number}: {Object.keys(current.afterWait.facts).map((field) => factLabels[field]).join(", ")} = Yes</p> : null}{!current.enters ? <p className="text-sm">Entry filters exclude this scenario.</p> : <ol className="space-y-3 border-t pt-4">{current.trace.map((entry, index) => <li key={index} className="flex gap-3 text-xs leading-5"><span className="h-fit shrink-0 rounded bg-muted px-2 font-medium">{stepLabels[entry.type]}</span><span>{entry.detail}</span></li>)}</ol>}</> : null}</div></div>
    </> : null}
  </DialogContent></Dialog>;
}
