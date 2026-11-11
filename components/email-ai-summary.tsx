"use client";

import { useLanguage } from "@/components/language-provider";

import { AiIcon } from "@/components/ai-icon";

import { useEffect, useEffectEvent, useState } from "react";
import Link from "next/link";
import { Check, Package2 } from "lucide-react";
import type { EmailSummary } from "@/lib/ai/email-summary";
import { requestEmailSummary } from "@/lib/email-summary-client";

function SummarySources({ ids, summary }: { ids: string[]; summary: EmailSummary }) {
  const sources = summary.research?.sources ?? [];
  return <span className="ml-1 inline-flex flex-wrap gap-1">{ids.flatMap(id => {
    const source = sources.find(source => source.id === id);
    return source ? [<a key={id} href={source.url} target="_blank" rel="noopener noreferrer" title={source.label} aria-label={`Source: ${source.label}`} className="rounded bg-violet-100 px-1 text-[10px] font-medium text-violet-800 hover:underline dark:bg-violet-500/15 dark:text-violet-200">{id}</a>] : [];
  })}</span>;
}

function SummaryCompanyResearch({ summary, language }: { summary: EmailSummary; language: string }) {
  if (!summary.research) return null;
  const zh = language === "zh-CN";
  const messages = {
    disabled: zh ? "公司调研已在 AI 设置中关闭。" : "Company research is disabled in AI settings.",
    no_identity: zh ? "需要公司名称或网站才能核实业务信息。" : "Add a company name or website to verify the business.",
    no_results: zh ? "未能核实该公司的公开信息。" : "Public company information could not be verified.",
    unavailable: zh ? "在线调研暂时不可用；以下分析仅依据对话。" : "Online research is unavailable; this brief uses conversation details.",
    complete: zh ? "未找到可确认属于该公司的信息。" : "No company findings could be confidently matched to this lead.",
  };
  return <div className="mt-4 border-t border-violet-200/70 pt-3 dark:border-violet-500/20">
    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">{zh ? "公司信息" : "Company research"}</p>
    {summary.companyFindings?.length ? <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-5">{summary.companyFindings.map((finding, index) => <li key={index}>{finding.text}<SummarySources ids={finding.sourceIds} summary={summary} /></li>)}</ul>
      : <p className="mt-1 text-xs leading-5 text-muted-foreground">{messages[summary.research.status]}</p>}
  </div>;
}

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
    <span className="min-w-0 flex-1">
      <span className="block break-words text-xs font-semibold leading-5">{product.title}</span>
      <span className="block text-xs leading-5 text-muted-foreground">{product.price || (language === "zh-CN" ? "询价" : "Price on request")}</span>
    </span>
  </Link>;
}

function SummaryProducts({ summary, language }: { summary: EmailSummary; language: string }) {
  const products = summary.products ?? [];
  const zh = language === "zh-CN";
  const unresolved = summary.unresolvedProducts ?? [];
  const confirmation = unresolved.length ? <p className="mt-2 text-xs leading-5 text-muted-foreground">
    {zh ? "待确认：" : "Needs confirmation: "}{unresolved.map(item => `${item.term} (${item.reason === "not_found" ? zh ? "无精确目录匹配" : "no exact catalog match" : zh ? "请确认规格或表面效果" : "confirm grade/finish"})`).join("; ")}
  </p> : null;
  if (!products.length) {
    const message = summary.productMatchStatus === "unavailable"
      ? zh ? "产品目录暂时无法加载，尚未核实产品匹配。" : "The product catalog could not be loaded. Product matches are unverified."
      : summary.productMatchStatus === "disabled"
        ? zh ? "AI 产品访问已关闭。" : "AI product access is disabled."
        : summary.productMatchStatus === "no_match"
          ? zh ? "尚未确认匹配产品。" : "No confirmed product match."
          : null;
    return message || confirmation ? <div className="mt-3">{message ? <p className="text-xs leading-5 text-muted-foreground">{message}</p> : null}{confirmation}</div> : null;
  }
  return <div className="mt-4 space-y-2" role="group" aria-label={zh ? "客户感兴趣的产品" : "Products of interest"}>
    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">{zh ? "推荐产品" : "Products to offer"}</p>
    {products.map(product => <SummaryProductCard key={product.sku} product={product} language={language} />)}
    {confirmation}
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
  const [cached, setCached] = useState(false);
  const getRequest = useEffectEvent(() => JSON.stringify({ ...JSON.parse(context), currentFollowUpAt, language }));
  const saveAnalysis = useEffectEvent((output: EmailSummary) => onAnalyzed(output));

  useEffect(() => {
    if (!configured || !ready) return;
    let active = true;
    async function generate() {
      setLoading(true);
      setError(null);
      setSaveError(null);
      try {
        const result = await requestEmailSummary(getRequest());
        const output = result.summary;
        if (active) {
          setSummary(output);
          setCached(result.cached);
          try {
            if (!result.cached) await saveAnalysis(output);
          } catch (error) {
            if (active) setSaveError(error instanceof Error ? error.message : "Unable to save the AI follow-up.");
          }
        }
      } catch (error) {
        if (active) setError(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? "AI analysis timed out. Please try again."
          : error instanceof Error ? error.message : "Unable to analyze this conversation. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void generate();
    return () => { active = false; };
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
    </div>
    <p className="mb-3 text-xs leading-5 text-muted-foreground">Key buying signals, company research and products to offer.</p>
    {summary && !loading && !error ? <p className="mb-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><Check className="size-3.5" />{saveError ? "Summary ready · Follow-up not saved" : cached ? "Saved analysis" : "Analysis complete"}</p> : null}
    <div className="rounded-2xl border border-violet-300/80 bg-gradient-to-br from-sky-50 via-violet-50/70 to-background p-4 dark:border-violet-500/40 dark:from-sky-500/10 dark:via-violet-500/10">
      <div aria-live="polite" aria-busy={loading}>
        {!configured ? <p className="text-xs leading-5 text-muted-foreground">Connect an AI provider in Settings to generate conversation summaries.</p>
          : !ready ? <p className="text-xs leading-5 text-muted-foreground">Waiting for the message to load before analysis.</p>
          : loading && !summary ? <p className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300"><AiIcon state="thinking" />Researching company and checking product fit…</p>
          : error && !summary ? <div><p className="text-xs leading-5 text-muted-foreground">{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-2 text-xs font-semibold text-primary hover:underline">Try again</button></div>
          : summary ? <><h4 className="flex items-start gap-2 text-sm font-semibold"><AiIcon className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-300" />{summary.title}</h4><p className="mt-3 text-xs leading-5">{summary.summary}</p>{summary.keyPoints?.length ? <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-5">{summary.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul> : null}<SummaryCompanyResearch summary={summary} language={language} /><SummaryProducts summary={summary} language={language} /><div className="mt-4 border-t border-violet-200/70 pt-3 dark:border-violet-500/20"><p className="text-xs font-semibold text-violet-700 dark:text-violet-300">Suggested next step</p><p className="mt-1 text-xs leading-5">{summary.nextStep}</p></div></> : null}
      </div>
      {summary && error ? <div role="status" className="mt-3 text-xs leading-5 text-destructive">{error}<button type="button" onClick={() => setAttempt(value => value + 1)} className="ml-2 font-semibold text-primary hover:underline">Retry next step</button></div> : null}
      {saveError ? <div role="status" className="mt-3 border-t border-violet-200/70 pt-3"><p className="text-xs leading-5 text-destructive">The summary is ready, but the follow-up could not be saved: {saveError}</p><button type="button" disabled={loading} onClick={() => void retrySaving()} className="mt-2 text-xs font-semibold text-primary hover:underline disabled:opacity-40">Retry saving follow-up</button></div> : null}
      {loading && summary ? <p role="status" className="mt-3 text-xs text-muted-foreground">Updating suggested next step…</p> : null}
      <p className="mt-4 text-[11px] leading-4 text-muted-foreground">AI generated · Follow-up scheduled automatically when needed</p>
    </div>
  </section>;
}
