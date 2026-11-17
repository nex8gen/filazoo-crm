"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Bell, Check, Clock3, GitBranch, Mail, Plus, Search, Sparkles, Tag, UserRoundCheck, Workflow } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createFlowRecipe, flowRecipeOptions } from "@/lib/flow-recipes";
import { flowActionLocations, flowPaths } from "@/lib/flow-tree";
import { stepLabels, type FlowInput } from "@/lib/flows";
import { useLanguage } from "@/components/language-provider";
import "./flow-starter-dialog.css";

type Step = FlowInput["steps"][number];
const previewIcons = { ai_auto_reply: Sparkles, send_email: Mail, wait: Clock3, split: GitBranch, if_condition: GitBranch, create_task: UserRoundCheck, internal_alert: Bell, change_category: Tag, update_company: Workflow, stop: Check };

export function FlowStarterDialog({ onChoose, onOpenChange, viewerId }: { onChoose: (flow: FlowInput) => void; onOpenChange: (open: boolean) => void; viewerId: string }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  // Previews use the same definitions as the selected draft. Choosing a card
  // creates a separate definition with new action identities for this editor.
  const recipes = useMemo(() => flowRecipeOptions.map(recipe => ({ ...recipe, preview: createFlowRecipe(recipe.id) })), []);
  const filtered = recipes.filter(recipe => [recipe.title, recipe.description, recipe.trigger, t(recipe.title), t(recipe.description), t(recipe.trigger), ...flowActionLocations(recipe.preview.steps).flatMap(({ action }) => [stepLabels[action.type], t(stepLabels[action.type])])].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return <Sheet open onOpenChange={onOpenChange}><SheetContent side="bottom" className="flow-starter-sheet" overlayClassName="flow-starter-overlay">
    <SheetHeader className="flow-starter-header"><SheetTitle>Create workflow</SheetTitle><SheetDescription>Start from scratch or make a prebuilt workflow your own.</SheetDescription></SheetHeader>
    <div className="flow-starter-scroll scroll-surface">
      <div className="flow-starter-library">
        <section className="flow-starter-scratch-section" aria-label={t("Start from scratch")}>
          <button type="button" className="flow-starter-scratch" onClick={() => onChoose(createFlowRecipe("blank"))}>
            <span className="flow-starter-plus"><Plus aria-hidden className="size-5" /></span>
            <span><strong>{t("Start from scratch")}</strong><span>{t("Build your own trigger and actions.")}</span></span>
            <ArrowRight aria-hidden className="ml-auto size-4 text-muted-foreground" />
          </button>
        </section>
        <section aria-labelledby="flow-starter-prebuilt-title">
          <div className="flow-starter-library-heading"><div><h2 id="flow-starter-prebuilt-title">{t("Prebuilt workflows")}</h2><p>{t("Choose a flow to preview and customize in the builder.")}</p></div>
            <label className="flow-starter-search"><span className="sr-only">{t("Search prebuilt workflows")}</span><Search aria-hidden className="size-4" /><Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search prebuilt workflows")} /></label>
          </div>
          <p className="sr-only" role="status">{t(`${filtered.length} workflows`)}</p>
          <div className="flow-starter-grid">{filtered.map(recipe => <button key={recipe.id} type="button" className="flow-starter-card" onClick={() => onChoose(createFlowRecipe(recipe.id, { assigneeId: viewerId }))} aria-label={t(recipe.title)}>
            <RecipePreview flow={recipe.preview} trigger={t(recipe.trigger)} />
            <div className="flow-starter-card-content"><div className="flow-starter-card-meta"><Badge variant="secondary">{t(recipe.trigger)}</Badge><span>{t(`${flowActionLocations(recipe.preview.steps).length} actions`)}</span></div><div className="flow-starter-card-title"><h3>{t(recipe.title)}</h3><ArrowRight aria-hidden className="size-4 shrink-0" /></div><p>{t(recipe.description)}</p></div>
          </button>)}</div>
          {!filtered.length ? <div className="flow-starter-empty"><Search aria-hidden className="mx-auto mb-3 size-6 text-muted-foreground" /><h3>{t("No matching workflows")}</h3><p>{t("Try a different name, trigger, or action.")}</p><Button variant="outline" size="sm" onClick={() => setQuery("")}>{t("Clear search")}</Button></div> : null}
        </section>
      </div>
    </div>
    <footer className="flow-starter-footer">{t("Every workflow starts as a draft. Customize and test it before turning it on.")}</footer>
  </SheetContent></Sheet>;
}

function RecipePreview({ flow, trigger }: { flow: FlowInput; trigger: string }) {
  const { t } = useLanguage();
  const splitAt = flow.steps.findIndex(step => step.type === "split");
  const steps = flow.steps.slice(0, splitAt >= 0 ? Math.min(splitAt + 1, 3) : 3);
  return <div className="flow-starter-preview" aria-hidden="true">
    <div className="flow-starter-preview-node flow-starter-preview-trigger"><Workflow className="size-3" /><span>{trigger}</span></div>
    {steps.map((step, index) => <div key={index} className="flow-starter-preview-stage"><span className="flow-starter-preview-connector" /><PreviewNode step={step} />
      {step.type === "split" ? <div className="flow-starter-preview-branches">{flowPaths(step.config).slice(0, 2).map((path, pathIndex) => <div key={pathIndex} className="flow-starter-preview-branch"><span className="flow-starter-preview-branch-label">{t(path.name)}</span>{path.steps[0] ? <PreviewNode step={path.steps[0]} /> : <span className="flow-starter-preview-end">{t("End")}</span>}</div>)}</div> : null}
    </div>)}
  </div>;
}

function PreviewNode({ step }: { step: Step }) {
  const { t } = useLanguage();
  const Icon = previewIcons[step.type];
  const label = step.type === "wait" ? `${t("Wait")} ${step.config.amount || 1} ${t(String(step.config.unit || "days"))}` : step.type === "split" ? t(String(step.config.name || stepLabels[step.type])) : t(stepLabels[step.type]);
  return <div className={`flow-starter-preview-node flow-starter-preview-${step.type}`}><Icon className="size-3" /><span>{label}</span></div>;
}
