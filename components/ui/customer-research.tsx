"use client";

import { Globe } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import type { CustomerResearch } from "@/lib/ai/customer-research";

export type ResearchResult = Omit<CustomerResearch, "findings">;

export function WebSearchOption({ enabled, onChange, disabled }: { enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean }) {
  const { t } = useLanguage();
  return <button type="button" aria-pressed={enabled} disabled={disabled} onClick={() => onChange(!enabled)} title={t("Search Google and visit company websites for customer research")} className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${enabled ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}><Globe aria-hidden="true" className="size-3.5" />{t("Web search")}</button>;
}

export function CustomerResearchSources({ research }: { research?: ResearchResult }) {
  const { language, t } = useLanguage();
  if (!research) return null;
  return <div className="mt-3 space-y-2 text-xs text-muted-foreground">
    <p className="flex flex-wrap items-center gap-1.5"><Globe aria-hidden="true" className="size-3.5" />{research.status === "complete" ? t("Web research") : t("Web research incomplete")}<span>· {new Date(research.checkedAt).toLocaleString(language, { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })}</span></p>
    {research.warning ? <p role="status" className="leading-5">{t(research.warning)}</p> : null}
    {research.sources.length ? <details><summary className="cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">{t("Web sources")} ({research.sources.length})</summary><ul className="mt-1 space-y-2">{research.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline underline-offset-2">[{source.id}] <span data-no-translate>{source.label}</span></a></li>)}</ul></details> : null}
    {research.searchSuggestionsHtml ? <iframe title={t("Google Search suggestions")} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={research.searchSuggestionsHtml} className="h-28 w-full rounded-lg border-0 bg-white" /> : null}
  </div>;
}
