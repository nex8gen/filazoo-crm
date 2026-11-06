"use client";

import { BookOpen, ChevronDown, Database, ExternalLink, Globe, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import type { CustomerResearch } from "@/lib/ai/customer-research";
import type { ResearchProgress } from "@/lib/ai/research-progress";
import { citationParts, citationUrl, sourceDomain, type CitationSource } from "@/lib/ai/source-citations";

export type ResearchResult = Omit<CustomerResearch, "findings">;

export function SourceIcon({ source }: { source: CitationSource }) {
  const domain = sourceDomain(source);
  const [loadedDomain, setLoadedDomain] = useState<string | null>(null);
  const loaded = Boolean(domain && loadedDomain === domain);
  return <span aria-hidden="true" className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
    {domain ? <Globe className={`size-3.5 ${loaded ? "invisible" : ""}`} /> : <Database className="size-3.5" />}
    {/* Publisher domains vary per answer. Native images avoid an unrestricted Next image proxy. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {domain ? <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`} width={16} height={16} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoadedDomain(domain)} onError={event => { event.currentTarget.style.display = "none"; }} className={`absolute inset-0 size-4 rounded-full bg-background object-contain ${loaded ? "opacity-100" : "opacity-0"}`} /> : null}
  </span>;
}

export function SourceCitedText({ text, sources }: { text: string; sources: CitationSource[] }) {
  const { t } = useLanguage();
  return <>{citationParts(text, sources).map((part, index) => {
    if (!part.source) return <span key={index}>{part.text}</span>;
    const source = part.source, domain = sourceDomain(source), url = citationUrl(source.url);
    const content = <><SourceIcon source={source} /><span className="max-w-36 truncate">{domain || source.label}</span><span className="text-[9px] opacity-65">{source.id.replace(/^W/, "")}</span></>;
    const className = "mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-border/50 bg-muted/60 px-1.5 py-0.5 align-baseline text-[10px] font-medium leading-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
    return url ? <a key={index} href={url} target="_blank" rel="noopener noreferrer" title={`${source.label} [${source.id}]`} aria-label={`${t("Source")}: ${source.label} [${source.id}]`} className={className}>{content}</a> : <span key={index} title={source.label} className={className}>{content}</span>;
  })}</>;
}

export function SourceList({ sources, live = false }: { sources: CitationSource[]; live?: boolean }) {
  const { t } = useLanguage();
  const safeSources = sources.filter(source => !source.url || citationUrl(source.url));
  if (!safeSources.length) return null;
  const icons = [...new Map(safeSources.map(source => [sourceDomain(source) || source.id, source])).values()].slice(0, 3);
  return <details className="group/source-list min-w-0 text-xs" data-research-sources>
    <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-2 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      <BookOpen aria-hidden="true" className="size-3.5" />
      <span className="flex -space-x-1">{icons.map(source => <span key={source.id} className="rounded-full ring-2 ring-background"><SourceIcon source={source} /></span>)}</span>
      <span>{t("Sources")}</span><span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{safeSources.length}</span>
      <ChevronDown aria-hidden="true" className="size-3 transition-transform motion-reduce:transition-none group-open/source-list:rotate-180" />
    </summary>
    <ul aria-label={t(live ? "Sources found so far" : "Sources")} className="mt-1 space-y-1">
      {safeSources.map(source => {
        const domain = sourceDomain(source), url = citationUrl(source.url);
        const content = <><SourceIcon source={source} /><span className="min-w-0 flex-1"><span className="break-words font-medium text-foreground" data-no-translate>{source.label}</span>{domain ? <span className="ml-2 inline-block text-[10px] text-muted-foreground" data-no-translate>{domain}</span> : null}</span><span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{source.id.replace(/^W/, "")}</span>{url ? <ExternalLink aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/60" /> : null}</>;
        return <li key={source.id} className="min-w-0">{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">{content}</a> : <div className="flex min-h-9 items-center gap-2 px-2 py-1">{content}</div>}</li>;
      })}
    </ul>
  </details>;
}

export function ResearchSearching({ progress }: { progress?: ResearchProgress | null }) {
  const { t } = useLanguage();
  const label = !progress ? "Preparing web research" : progress.phase === "reading" ? "Reading company websites" : progress.phase === "writing" ? progress.sources.length ? "Preparing answer with sources" : "Preparing answer" : "Searching Google";
  return <div className="mt-3 space-y-1 rounded-xl border border-border/60 bg-muted/20 px-3 py-2" aria-busy="true">
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground"><SourceIcon source={{ id: "google", label: "Google", url: "https://google.com/" }} /><span>{t(label)}</span><LoaderCircle aria-hidden="true" className="ml-auto size-3.5 motion-safe:animate-spin" /></p>
    {progress?.queries.length ? <p className="truncate pl-6 text-[11px] text-muted-foreground" data-no-translate title={progress.queries.at(-1)}>{progress.queries.at(-1)}</p> : null}
    <SourceList sources={progress?.sources ?? []} live />
  </div>;
}

export function WebSearchOption({ enabled, onChange, disabled }: { enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean }) {
  const { t } = useLanguage();
  return <button type="button" aria-label={t("Web search")} aria-pressed={enabled} disabled={disabled} onClick={() => onChange(!enabled)} title={t("Search Google and visit company websites for customer research")} className={`ai-composer-action inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${enabled ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}><Globe aria-hidden="true" className="size-3.5 shrink-0" /><span className="ai-composer-action-label">{t(enabled ? "Web search on" : "Web search off")}</span></button>;
}

export function CustomerResearchSources({ research }: { research?: ResearchResult }) {
  const { language, t } = useLanguage();
  if (!research) return null;
  return <div className="mt-3 space-y-2 text-xs text-muted-foreground">
    <p className="flex flex-wrap items-center gap-1.5"><Globe aria-hidden="true" className="size-3.5" />{research.status === "complete" ? t("Web research") : t("Web research incomplete")}<span>· {new Date(research.checkedAt).toLocaleString(language, { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })}</span></p>
    {research.warning ? <p role="status" className="leading-5">{t(research.warning)}</p> : null}
    {research.queries?.length ? <details><summary className="cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">{t("Google search queries")} ({research.queries.length})</summary><ul className="mt-1 space-y-1">{research.queries.map((query, index) => <li key={`${index}-${query}`} data-no-translate>{query}</li>)}</ul></details> : null}
    {research.visitedUrls?.length ? <details><summary className="cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">{t("Pages read")} ({research.visitedUrls.length})</summary><ul className="mt-1 space-y-1">{research.visitedUrls.map(url => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline underline-offset-2" data-no-translate>{research.sources.find(source => source.url === url)?.label || new URL(url).hostname}</a></li>)}</ul></details> : null}
    <SourceList sources={research.sources} />
    {research.searchSuggestionsHtml ? <iframe title={t("Google Search suggestions")} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={research.searchSuggestionsHtml} className="h-28 w-full rounded-lg border-0 bg-white" /> : null}
  </div>;
}
