"use client";

import { useLanguage } from "@/components/language-provider";

import { AiIcon } from "@/components/ai-icon";

import { useEffect, useEffectEvent, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Package2, RefreshCw } from "lucide-react";
import { parseEmailSummary, type EmailSummary } from "@/lib/ai/email-summary";

function SummaryProductCard({ product, language }: { product: NonNullable<EmailSummary["products"]>[number]; language: string }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasImage = product.imageUrl && failedImage !== product.imageUrl;
  return <Link href={`/products/${encodeURIComponent(product.sku)}`} prefetch={false}
    aria-label={`${language === "zh-CN" ? "查看产品" : "View product"}: ${product.title}`}
    className="group flex min-w-0 items-center gap-3 rounded-xl border border-violet-200/80 bg-background/80 p-2.5 transition-colors hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:border-violet-500/25 dark:hover:bg-violet-500/10">
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
      {hasImage
        // Private and external catalog images use the same URLs as the product page.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={product.imageUrl!} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(product.imageUrl)} className="size-full object-contain" />
        : <Package2 aria-hidden="true" className="size-5 text-muted-foreground" />}
    </span>
    <span className="min-w-0 flex-1"><span className="block break-words text-xs font-semibold leading-5">{product.title}</span><span className="block break-all text-[10px] leading-4 text-muted-foreground">{product.sku}</span>{!hasImage ? <span className="block text-[10px] text-muted-foreground">{language === "zh-CN" ? "暂无图片" : "Image unavailable"}</span> : null}</span>
    <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
  </Link>;
}

function SummaryProducts({ summary, language }: { summary: EmailSummary; language: string }) {
  const products = summary.products ?? [];
  const zh = language === "zh-CN";
  if (!products.length) {
    const message = summary.productMatchStatus === "unavailable"
      ? zh ? "产品目录暂时无法加载，尚未核实产品匹配。" : "The product catalog could not be loaded. Product matches are unverified."
      : summary.productMatchStatus === "disabled"
        ? zh ? "AI 产品访问已关闭。" : "AI product access is disabled."
        : summary.productMatchStatus === "no_match"
          ? zh ? "尚未确认匹配产品。" : "No confirmed product match."
          : null;
    return message ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{message}</p> : null;
  }
  return <div className="mt-4 space-y-2" role="group" aria-label={zh ? "客户感兴趣的产品" : "Products of interest"}>
    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">{zh ? "客户感兴趣的产品" : "Products of interest"}</p>
    {products.map(product => <SummaryProductCard key={product.sku} product={product} language={language} />)}
  </div>;
}

export function EmailAiSummary({ context, configured, ready, currentFollowUpAt, onAnalyzed }: {
  context: string;
  configured: boolean;
  ready: boolean;
  currentFollowUpAt: string | null;
  onAnalyzed: (summary: EmailSummary) => Promise<void>;
}) {
  const { language } = useLanguage();
  const [summary, setSummary] = useState<EmailSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const getRequest = useEffectEvent(() => JSON.stringify({ ...JSON.parse(context), currentFollowUpAt, language }));
  const saveAnalysis = useEffectEvent((output: EmailSummary) => onAnalyzed(output));

  useEffect(() => {
    if (!configured || !ready) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 45_000);
    async function generate() {
      setLoading(true);
      setError(null);
      setSaveError(null);
      setSummary(null);
      try {
        const response = await fetch("/api/email/assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: getRequest(),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) throw new Error(result?.error || "Unable to generate a summary. Check your connection and sign in again if your session expired.");
        const output = parseEmailSummary(result.output);
        if (active) {
          setSummary(output);
          try {
            await saveAnalysis(output);
          } catch (error) {
            if (active) setSaveError(error instanceof Error ? error.message : "Unable to save the AI follow-up.");
          }
        }
      } catch (error) {
        if (active) setError(controller.signal.aborted
          ? "AI analysis timed out. Please try again."
          : error instanceof Error ? error.message : "Unable to analyze this conversation. Please try again.");
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void generate();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [context, configured, ready, attempt, language]);

  async function retrySaving() {
    if (!summary) return;
    setLoading(true);
    setSaveError(null);
    try {
      await onAnalyzed(summary);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save the AI follow-up.");
    } finally {
      setLoading(false);
    }
  }

  return <section className="mx-6 mb-6" aria-labelledby="email-ai-summary">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 id="email-ai-summary" className="flex items-center gap-2 text-sm font-semibold text-primary"><AiIcon state={loading ? "thinking" : "idle"} />AI summary</h3>
      <button type="button" disabled={loading || !configured || !ready} onClick={() => setAttempt((value) => value + 1)} aria-label="Regenerate AI summary" className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></button>
    </div>
    <p className="mb-3 text-xs leading-5 text-muted-foreground">Based on this conversation and available contact details.</p>
    {summary && !loading && !error ? <p className="mb-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><Check className="size-3.5" />{saveError ? "Summary ready · Follow-up not saved" : "Analysis complete"}</p> : null}
    <div className="rounded-2xl border border-violet-300/80 bg-gradient-to-br from-sky-50 via-violet-50/70 to-background p-4 dark:border-violet-500/40 dark:from-sky-500/10 dark:via-violet-500/10">
      <div aria-live="polite" aria-busy={loading}>
        {!configured ? <p className="text-xs leading-5 text-muted-foreground">Connect an AI provider in Settings to generate conversation summaries.</p>
          : !ready ? <p className="text-xs leading-5 text-muted-foreground">Waiting for the message to load before analysis.</p>
          : loading && !summary ? <p className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300"><AiIcon state="thinking" />Analyzing conversation…</p>
          : error ? <div><p className="text-xs leading-5 text-muted-foreground">{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-2 text-xs font-semibold text-primary hover:underline">Try again</button></div>
          : summary ? <><h4 className="flex items-start gap-2 text-sm font-semibold"><AiIcon className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-300" />{summary.title}</h4><p className="mt-3 whitespace-pre-wrap text-sm leading-6">{summary.summary}</p><SummaryProducts summary={summary} language={language} /><div className="mt-4 border-t border-violet-200/70 pt-3 dark:border-violet-500/20"><p className="text-xs font-semibold text-violet-700 dark:text-violet-300">Suggested next step</p><p className="mt-1 text-xs leading-5">{summary.nextStep}</p></div></> : null}
      </div>
      {saveError ? <div role="status" className="mt-3 border-t border-violet-200/70 pt-3"><p className="text-xs leading-5 text-destructive">The summary is ready, but the follow-up could not be saved: {saveError}</p><button type="button" disabled={loading} onClick={() => void retrySaving()} className="mt-2 text-xs font-semibold text-primary hover:underline disabled:opacity-40">Retry saving follow-up</button></div> : null}
      {loading && summary ? <p role="status" className="mt-3 text-xs text-muted-foreground">Saving follow-up…</p> : null}
      <p className="mt-4 text-[11px] leading-4 text-muted-foreground">AI generated · Follow-up scheduled automatically when needed</p>
    </div>
  </section>;
}
