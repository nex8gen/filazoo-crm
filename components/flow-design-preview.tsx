"use client";

import { Bell, Building2, CircleStop, Clock3, GitBranch, Mail, Sparkles, Tag, UserRoundCheck, Workflow } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { flowActionLocations, flowPaths } from "@/lib/flow-tree";
import { formatTrigger, stepLabels, type FlowInput } from "@/lib/flows";
import "./flow-design-preview.css";

type Step = FlowInput["steps"][number];
const icons = { ai_auto_reply: Sparkles, send_email: Mail, wait: Clock3, split: GitBranch, if_condition: GitBranch, create_task: UserRoundCheck, internal_alert: Bell, change_category: Tag, update_company: Building2, stop: CircleStop };

/** A compact overview of the saved definition; omitted actions are counted explicitly. */
export function FlowDesignPreview({ flow }: { flow: FlowInput }) {
  const { t } = useLanguage();
  const splitAt = flow.steps.findIndex(step => step.type === "split");
  const steps = flow.steps.slice(0, splitAt >= 0 && splitAt < 3 ? splitAt + 1 : 3);
  const shownActions = steps.reduce((count, step) => count + 1 + (step.type === "split" ? flowPaths(step.config).slice(0, 3).filter(path => path.steps.length > 0).length : 0), 0);
  const remaining = flowActionLocations(flow.steps).length - shownActions;

  return <div className="flow-design-preview" aria-hidden="true">
    <div className="flow-design-node flow-design-trigger"><Workflow /><span>{t(formatTrigger(flow.triggerType, flow.triggerConfig))}</span></div>
    {steps.map((step, index) => <div key={step.id || index} className="flow-design-stage">
      <span className="flow-design-connector" /><PreviewNode step={step} />
      {step.type === "split" ? <div className="flow-design-branches" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, flowPaths(step.config).length))}, minmax(0, 1fr))` }}>
        {flowPaths(step.config).slice(0, 3).map((path, pathIndex) => <div className="flow-design-branch" key={path.id || pathIndex}><span className="flow-design-path" title={path.name}>{t(path.name)}</span>{path.steps[0] ? <PreviewNode step={path.steps[0]} /> : <span className="flow-design-end">{t("End")}</span>}</div>)}
      </div> : null}
      {step.type === "split" && flowPaths(step.config).length > 3 ? <span className="flow-design-more">{t(`+${flowPaths(step.config).length - 3} more paths`)}</span> : null}
    </div>)}
    <span className="flow-design-connector" />
    <span className="flow-design-end">{remaining > 0 ? t(`+${remaining} more actions`) : t("End")}</span>
  </div>;
}

function PreviewNode({ step }: { step: Step }) {
  const { t } = useLanguage();
  const Icon = icons[step.type];
  const label = step.type === "wait" ? `${t("Wait")} ${step.config.amount || 1} ${t(String(step.config.unit || "days"))}` : step.type === "split" ? String(step.config.name || t(stepLabels[step.type])) : t(stepLabels[step.type]);
  return <div className={`flow-design-node flow-design-${step.type}`}><Icon /><span title={label}>{label}</span></div>;
}
