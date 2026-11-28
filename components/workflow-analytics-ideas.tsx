"use client";

import { AiIcon } from "@/components/ai-icon";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { HomePromptIcon } from "@/components/home-prompt-icon";
import { useLanguage } from "@/components/language-provider";
import { launchWorkspaceAi } from "@/lib/ai/launch";
import { workflowAnalyticsPrompts } from "@/lib/flow-analytics-prompts";
import "./workflow-analytics-ideas.css";

export function WorkflowAnalyticsIdeas({ canEdit }: { canEdit: boolean }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const prompts = workflowAnalyticsPrompts.filter(prompt => canEdit || prompt.mode === "chat");

  return <div className="workflow-analytics-ideas" data-expanded={expanded}>
    <button type="button" className="workflow-analytics-ideas-toggle" aria-label={t(expanded ? "Collapse ideas to try" : "Expand ideas to try")} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <ChevronDown aria-hidden className="size-3.5" /><span className={expanded ? "sr-only" : ""}>{t("Ideas to try")}</span>
    </button>
    <div id={id} className="workflow-analytics-ideas-items" role="group" aria-label={t("Workflow analytics ideas")}>
      {prompts.map(prompt => <button key={prompt.id} type="button" className="workflow-analytics-idea" onClick={() => launchWorkspaceAi({ mode: prompt.mode, prompt: prompt.prompt, submit: true })}>
        <span aria-hidden className="workflow-analytics-idea-icon">{expanded ? <HomePromptIcon name={prompt.icon} /> : <AiIcon className="size-3.5" />}</span>
        <span className="workflow-analytics-idea-copy"><span className="workflow-analytics-idea-title">{t(prompt.label)}</span>{expanded ? <span className="workflow-analytics-idea-description">{t(prompt.description)}</span> : null}</span>
      </button>)}
    </div>
  </div>;
}
