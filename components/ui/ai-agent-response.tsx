"use client";

import { useEffect, useEffectEvent, useId, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Database, FileText } from "lucide-react";
import { cn } from "cn";
import { ThinkingGlyph } from "@/components/ui/thinking-indicator";
import "./ai-agent-response.css";

// Adapted from the supplied response design. Progress follows real request
// state; there are no simulated reasoning, terminal or tool-execution traces.
export type ResponseStep = { id: string; label: string; detail?: string };

export function ThinkingState({ working, writing = false, durationMs, scope, steps = [], className }: {
  working: boolean;
  writing?: boolean;
  durationMs?: number;
  scope: string;
  steps?: ResponseStep[];
  className?: string;
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const id = useId();
  const expanded = manualExpanded ?? working;
  const active = working || writing;

  useEffect(() => {
    if (!working) return;
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, [working]);

  return <div className={cn("agent-response-trace flex min-w-0 flex-col text-foreground", className)}>
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setManualExpanded(!expanded)} className="group inline-flex min-h-8 w-fit max-w-full items-center gap-2 rounded-sm text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
      {active ? <ThinkingGlyph className="size-3.5 text-violet-600 dark:text-violet-300" duration={2.4} /> : <Check aria-hidden="true" className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
      <span className={cn("min-w-0", active && "agent-shimmer")}>
        {working ? "Thinking…" : writing ? "Writing reply…" : <>Answered in <span className="font-mono text-xs tabular-nums">{((durationMs ?? 0) / 1_000).toFixed(1)}s</span></>}
      </span>
      {working && elapsed > 0 ? <span aria-hidden="true" className="font-mono text-[11px] tabular-nums opacity-60">{elapsed}s</span> : null}
      <ChevronDown aria-hidden="true" className={cn("size-3 shrink-0 opacity-40 transition-transform duration-300 group-hover:opacity-80", expanded && "rotate-180")} />
    </button>
    <div id={id} inert={!expanded} aria-hidden={!expanded} className={cn("agent-trace-details grid transition-[grid-template-rows,opacity] duration-300", expanded ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0")}>
      <div className="min-h-0 overflow-hidden">
        <div className="mb-2 ml-1.5 mt-1 space-y-1 border-l border-border/70 py-1 pl-3">
          <div className="flex min-h-7 min-w-0 items-center gap-2 text-xs"><Database aria-hidden="true" className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><span className="shrink-0 font-medium">Customer</span><span data-no-translate className="truncate rounded-md border border-border/40 bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">{scope}</span></div>
          {working ? <div className="flex min-h-7 items-center gap-2 text-xs text-muted-foreground"><span aria-hidden="true" className="agent-trace-spinner size-3.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground/30 border-t-foreground" /><span>Preparing an answer from saved customer records</span></div> : steps.map((step) => <div key={step.id} className="flex min-h-7 items-start gap-2 py-1 text-xs"><FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="break-words font-medium">{step.label}</p>{step.detail ? <p data-no-translate className="mt-0.5 break-words text-[11px] leading-5 text-muted-foreground">{step.detail}</p> : null}</div></div>)}
          {!working && !steps.length ? <p className="py-1 text-xs leading-5 text-muted-foreground">Reply prepared using the available customer context.</p> : null}
        </div>
      </div>
    </div>
  </div>;
}

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeToMotion(onChange: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const getMotion = () => window.matchMedia(motionQuery).matches;
const getServerMotion = () => false;

export function StreamingText({ text, animate = true, onComplete, onProgress, className }: {
  text: string;
  animate?: boolean;
  onComplete?: () => void;
  onProgress?: () => void;
  className?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeToMotion, getMotion, getServerMotion);
  const complete = useEffectEvent(() => onComplete?.());
  const progress = useEffectEvent(() => onProgress?.());
  const characters = Array.from(text);
  const finished = !animate || reducedMotion || visibleCount >= characters.length;

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let started: number | undefined;
    const length = Array.from(text).length;
    // Preserve the reference's flowing reveal without making long answers
    // take tens of seconds after the real request has already completed.
    const duration = reducedMotion ? 0 : Math.min(3_000, length * 9);
    function tick(now: number) {
      started ??= now;
      const ratio = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      setVisibleCount(Math.floor(length * ratio));
      progress();
      if (ratio < 1) frame = window.requestAnimationFrame(tick);
      else complete();
    }
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [text, animate, reducedMotion]);

  return <div data-no-translate className={cn("agent-streaming-text whitespace-pre-wrap break-words text-sm leading-7 text-foreground/90 [overflow-wrap:anywhere]", className)}>
    <span className="sr-only">{text}</span>
    <span aria-hidden="true">{finished ? text : characters.slice(0, visibleCount).join("")}{!finished ? <span className="agent-writing-cursor" /> : null}</span>
  </div>;
}
