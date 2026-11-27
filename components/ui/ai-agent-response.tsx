"use client";

import { useEffect, useEffectEvent, useId, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, Check, ChevronDown, Database, FileText, CircleAlert } from "lucide-react";
import { cn } from "cn";
import { ThinkingGlyph } from "@/components/ui/thinking-indicator";
import { AgentWorkIcon } from "@/components/agent-work-icon";
import { agentWorkAreaLabels, type AgentWorkProgress } from "@/lib/ai/agent-progress";
import "./ai-agent-response.css";
import { AiMarkdown } from "@/components/ui/ai-markdown";
import { useLanguage } from "@/components/language-provider";
import type { AssistantActivity } from "@/lib/ai/research-progress";
import type { CitationSource } from "@/lib/ai/source-citations";
import { splitFollowUpQuestions } from "@/lib/ai/follow-up-questions";

// Adapted from the supplied response design. Progress follows real request
// state; there are no simulated reasoning, terminal or tool-execution traces.
export type ResponseStep = { id: string; label: string; detail?: string; status?: AssistantActivity["status"]; durationMs?: number };

export function ThinkingState({ working, writing = false, failed = false, errorMessage, durationMs, scope, steps = [], activity, className }: {
  working: boolean;
  writing?: boolean;
  failed?: boolean;
  errorMessage?: string;
  durationMs?: number;
  scope: string;
  steps?: ResponseStep[];
  activity?: AgentWorkProgress;
  className?: string;
}) {
  const { t } = useLanguage();
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const id = useId();
  const expanded = manualExpanded ?? (working || failed);
  const active = working || writing;
  const current = [...steps].reverse().find(step => step.status === "active");
  const label = working ? current?.label || (steps.length ? "Finishing request" : activity?.label || "Connecting to assistant…") : failed ? "Request interrupted" : writing ? "Writing reply…" : "Answered";

  useEffect(() => {
    if (!working) return;
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, [working]);

  return <div className={cn("agent-response-trace flex min-w-0 flex-col text-foreground", className)} aria-busy={working}>
    <span className="sr-only" role="status" aria-live="polite">{t(label)}</span>
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setManualExpanded(!expanded)} className="group inline-flex min-h-8 w-fit max-w-full items-center gap-2 rounded-sm text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
      {active ? <ThinkingGlyph className="size-3.5 text-violet-600 dark:text-violet-300" duration={2.4} /> : failed ? <CircleAlert aria-hidden="true" className="size-3.5 shrink-0 text-destructive" /> : <Check aria-hidden="true" className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
      <span className={cn("min-w-0 break-words", active && "agent-shimmer")}>{t(label)}</span>
      {working && elapsed > 0 ? <span aria-hidden="true" className="shrink-0 font-mono text-xs tabular-nums opacity-60">{elapsed}s</span> : !active && !failed && durationMs !== undefined ? <span className="shrink-0 font-mono text-xs tabular-nums opacity-60">{(durationMs / 1_000).toFixed(1)}s</span> : null}
      <ChevronDown aria-hidden="true" className={cn("size-3 shrink-0 opacity-40 transition-transform duration-300 group-hover:opacity-80", expanded && "rotate-180")} />
    </button>
    <div id={id} inert={!expanded} aria-hidden={!expanded} className={cn("agent-trace-details grid transition-[grid-template-rows,opacity] duration-300", expanded ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0")}>
      <div className="min-h-0 overflow-hidden">
        <div className="mb-2 ml-1.5 mt-1 space-y-1 border-l border-border/70 py-1 pl-3">
          {failed && errorMessage ? <p role="alert" className="mb-2 max-w-full break-words text-sm leading-6 text-destructive [overflow-wrap:anywhere]">{t(errorMessage)}</p> : null}
          <div className="flex min-h-7 min-w-0 items-center gap-2 text-xs"><Database aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="shrink-0 font-medium">{t("Context")}</span><span data-no-translate className="truncate rounded-md border border-border/40 bg-muted/70 px-1.5 py-0.5 text-xs text-muted-foreground">{scope}</span></div>
          {activity ? <div className="flex min-h-7 flex-wrap items-center gap-1.5 text-xs">{[activity.area, ...(activity.relatedAreas ?? [])].map(area => <span key={area} className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/15 bg-violet-500/5 px-2 py-1 font-medium"><AgentWorkIcon area={area} />{t(agentWorkAreaLabels[area])}</span>)}</div> : null}
          {steps.length ? <ol aria-label={t("Request activity")} className="space-y-1">{steps.map(step => <li key={step.id} className="flex min-h-7 items-start gap-2 py-1 text-xs" data-activity-status={step.status}>
            {step.status === "active" ? <span aria-hidden="true" className="agent-trace-spinner mt-0.5 size-3.5 shrink-0 rounded-full border-[1.5px] border-violet-500/25 border-t-violet-500" /> : step.status === "failed" ? <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : step.status === "complete" ? <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1"><p className={cn("break-words leading-5", step.status === "active" ? "font-medium text-foreground" : "text-muted-foreground")}>{t(step.label)}{step.status === "failed" ? <span className="ml-1 text-destructive">· {t("Failed")}</span> : null}</p>{step.detail ? <p data-no-translate className="mt-0.5 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{step.detail}</p> : null}</div>
            {step.durationMs !== undefined ? <span className="pt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/70">{(step.durationMs / 1_000).toFixed(1)}s</span> : null}
          </li>)}</ol> : activity?.detail ? <p data-no-translate className="break-words py-1 text-xs leading-5 text-muted-foreground">{activity.detail}</p> : <p className="py-1 text-xs leading-5 text-muted-foreground">{t(working ? "Waiting for the assistant to start" : failed ? "The request stopped before an answer was ready." : "Reply prepared using the available context.")}</p>}
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

export function StreamingText({ text, animate = true, onComplete, onProgress, className, sources = [], onFollowUp, followUpsDisabled = false }: {
  text: string;
  animate?: boolean;
  onComplete?: () => void;
  onProgress?: () => void;
  className?: string;
  sources?: CitationSource[];
  onFollowUp?: (question: string) => void;
  followUpsDisabled?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeToMotion, getMotion, getServerMotion);
  const complete = useEffectEvent(() => onComplete?.());
  const progress = useEffectEvent(() => onProgress?.());
  const { answer, questions } = onFollowUp ? splitFollowUpQuestions(text) : { answer: text, questions: [] };
  const characters = Array.from(answer);
  const finished = !animate || reducedMotion || visibleCount >= characters.length;

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let started: number | undefined;
    const length = Array.from(answer).length;
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
  }, [answer, animate, reducedMotion]);

  return <div data-no-translate aria-busy={!finished} className={cn("agent-streaming-text break-words text-sm leading-7 text-foreground/90 [overflow-wrap:anywhere]", className)}>
    <AiMarkdown text={finished ? answer : characters.slice(0, visibleCount).join("")} sources={sources} streaming={!finished} />{!finished ? <span aria-hidden="true" className="agent-writing-cursor" /> : null}
    {finished && onFollowUp ? <AiFollowUpQuestions questions={questions} onSelect={onFollowUp} disabled={followUpsDisabled} /> : null}
  </div>;
}

export function AiFollowUpQuestions({ questions, onSelect, disabled = false }: { questions: string[]; onSelect: (question: string) => void; disabled?: boolean }) {
  const { language } = useLanguage();
  if (!questions.length) return null;
  return <div className="agent-follow-up-questions" role="group" aria-label={language === "zh-CN" ? "相关问题" : "Related questions"}>
    {questions.map(question => <button key={question} type="button" disabled={disabled} onClick={() => { if (!disabled) onSelect(question); }} className="agent-follow-up-button">
      <span>{question}</span><ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
    </button>)}
  </div>;
}
