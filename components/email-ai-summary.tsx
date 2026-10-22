"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { parseEmailSummary, type EmailSummary } from "@/lib/ai/email-summary";

export function EmailAiSummary({ context, configured, ready, currentFollowUpAt, onAnalyzed }: {
  context: string;
  configured: boolean;
  ready: boolean;
  currentFollowUpAt: string | null;
  onAnalyzed: (summary: EmailSummary) => Promise<void>;
}) {
  const [summary, setSummary] = useState<EmailSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const getRequest = useEffectEvent(() => JSON.stringify({ ...JSON.parse(context), currentFollowUpAt }));
  const saveAnalysis = useEffectEvent((output: EmailSummary) => onAnalyzed(output));

  useEffect(() => {
    if (!configured || !ready) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 45_000);
    async function generate() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/email/assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: getRequest(),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error("Unable to generate a summary. Please try again.");
        const output = parseEmailSummary(result.output);
        if (active) {
          setSummary(output);
          await saveAnalysis(output);
        }
      } catch {
        if (active) setError("Analysis or follow-up scheduling failed. Please try again.");
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void generate();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [context, configured, ready, attempt]);

  return <section className="mx-6 mb-6" aria-labelledby="email-ai-summary">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 id="email-ai-summary" className="flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="size-4" />AI summary</h3>
      <button type="button" disabled={loading || !configured || !ready} onClick={() => setAttempt((value) => value + 1)} aria-label="Regenerate AI summary" className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></button>
    </div>
    <p className="mb-3 text-xs leading-5 text-muted-foreground">Based on this conversation and available contact details.</p>
    {summary && !loading && !error ? <p className="mb-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><Check className="size-3.5" />Analysis complete</p> : null}
    <div className="rounded-2xl border border-violet-300/80 bg-gradient-to-br from-sky-50 via-violet-50/70 to-background p-4 dark:border-violet-500/40 dark:from-sky-500/10 dark:via-violet-500/10">
      <div aria-live="polite" aria-busy={loading}>
        {!configured ? <p className="text-xs leading-5 text-muted-foreground">Connect an AI provider in Settings to generate conversation summaries.</p>
          : !ready ? <p className="text-xs leading-5 text-muted-foreground">Waiting for the message to load before analysis.</p>
          : loading ? <p className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300"><LoaderCircle className="size-4 animate-spin" />Analyzing conversation…</p>
          : error ? <div><p className="text-xs leading-5 text-muted-foreground">{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-2 text-xs font-semibold text-primary hover:underline">Try again</button></div>
          : summary ? <><h4 className="flex items-start gap-2 text-sm font-semibold"><Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-300" />{summary.title}</h4><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{summary.summary}</p><div className="mt-4 border-t border-violet-200/70 pt-3 dark:border-violet-500/20"><p className="text-xs font-semibold text-violet-700 dark:text-violet-300">Suggested next step</p><p className="mt-1 text-xs leading-5">{summary.nextStep}</p></div></> : null}
      </div>
      <p className="mt-4 text-[11px] leading-4 text-muted-foreground">AI generated · Follow-up scheduled automatically when needed</p>
    </div>
  </section>;
}
