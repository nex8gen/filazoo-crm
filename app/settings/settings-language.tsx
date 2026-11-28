"use client";

import { Check, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";

export function SettingsLanguage() {
  const { language, setLanguage } = useLanguage();
  const [changed, setChanged] = useState(false);
  return <div className="space-y-4"><div role="group" aria-label="Language" className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[{ id: "en", title: "English", subtitle: "" }, { id: "zh-CN", title: "简体中文", subtitle: "Simplified Chinese" }].map(option => <button key={option.id} type="button" aria-pressed={language === option.id} onClick={() => { setLanguage(option.id as "en" | "zh-CN"); setChanged(true); }} className="flex min-h-14 items-center justify-between gap-3 settings-panel px-4 py-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-action-ring/40"><span><span data-no-translate className="block text-sm font-medium">{option.title}</span>{option.subtitle ? <span className="mt-1 block text-xs text-muted-foreground">{option.subtitle}</span> : null}</span><span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-full border ${language === option.id ? "border-foreground bg-foreground text-background" : "border-input"}`}>{language === option.id ? <Check className="size-3" /> : null}</span></button>)}</div><p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">{changed ? <CheckCircle2 aria-hidden="true" className="size-4 text-primary" /> : null}{changed ? "Language saved for this browser." : "Saved in this browser."}</p></div>;
}
