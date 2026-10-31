"use client";
import { CustomerTagBadge, CustomerTagLabel } from "@/components/customer-tag-badges";
import { isCustomerTag } from "@/lib/customer-tags";

import { FlowSenderField } from "@/components/flow-sender-field";
import { flowSenderOptions, type FlowMailboxOption } from "@/lib/flow-mailboxes";

import { EmptyState } from "@/components/data-state";
import Link from "next/link";
import { isSegmentAudienceFlow, segmentCompaniesHref } from "@/lib/segment-flows";
import { useLanguage } from "@/components/language-provider";

import { AiIcon } from "@/components/ai-icon";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDndContext, useDndMonitor, useDraggable, useDroppable, useSensor, useSensors, type DragMoveEvent } from "@dnd-kit/core";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Bell, Check, CheckCircle2, ChevronRight,
  CircleStop, Clock3, Copy, Eye, GitBranch, History, ListFilter, Mail, MoreHorizontal,
  Building2, GripVertical, Maximize2, Minus, Pause, Play, Plus, Save, Search, Settings2, Tag, Trash2, UserRoundCheck, Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { FlowActionPicker, type FlowActionChoice } from "@/components/flow-action-picker";
import { FlowOutline } from "@/components/flow-outline";
import { FlowActionCard } from "@/components/flow-action-card";
import { FlowInsights } from "@/components/flow-insights";
import { FlowCustomerPicker } from "@/components/flow-customer-picker";
import { FlowConditionEditor } from "@/components/flow-condition-editor";
import { auditFlowDefinition } from "@/lib/flow-audit";
import { editFlowSiblings, flowActionLocations, flowActionTrail, flowNodeWidth, FLOW_BRANCH_GAP, dropFlowAction, type FlowDropTarget } from "@/lib/flow-tree";
import type { FlowPreviewResult } from "@/lib/flow-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  emailFlowScope, blankStep, cloneFlowStep, companyStatuses, defaultFlowInput, emailCategories, flowInputSchema, flowLeadLists, formatTrigger, stepLabels, stepTypes,
  triggerLabels, triggerTypes, type AutomationFlow, type FlowInput, type FlowStatus, type FlowStepType,
  type JsonConfig, type TriggerType, type FlowBulkAction, type FlowBulkResult,
} from "@/lib/flows";
import {
  CANVAS_NODE_WIDTH, CANVAS_START_X, canvasPointFromClient,
  flowInsertIndex, layoutFlowNodes, reorderFlowSteps, fitFlowCanvas, MIN_FLOW_ZOOM, type CanvasPoint,
} from "@/lib/flow-canvas";

const LazyScenarioLab = lazy(() => import("@/components/flow-scenario-lab").then((module) => ({ default: module.FlowScenarioLab })));
const LazyStarterDialog = lazy(() => import("@/components/flow-starter-dialog").then((module) => ({ default: module.FlowStarterDialog })));
const LazyJourneyPreview = lazy(() => import("@/components/flow-journey-preview").then((module) => ({ default: module.FlowJourneyPreview })));
const LazyEmailTestDialog = lazy(() => import("@/components/flow-email-test-dialog").then((module) => ({ default: module.FlowEmailTestDialog })));

function FlowJourneyPreview(props: ComponentProps<typeof LazyJourneyPreview>) {
  return <Suspense fallback={<aside className="border-l p-5 text-sm lg:w-[360px]" role="status">Loading…</aside>}><LazyJourneyPreview {...props} /></Suspense>;
}
function FlowEmailTestDialog(props: ComponentProps<typeof LazyEmailTestDialog>) {
  return <Suspense fallback={null}><LazyEmailTestDialog {...props} /></Suspense>;
}

type Option = { id: string; label: string; disabled?: boolean };
type FilterOptions = { segments: string[]; countries: string[] };
type DraftFlow = FlowInput & { id: string | null; activeRuns?: number; completedRuns?: number; updatedAt?: string };
type Selection = "trigger" | string;
const templates: Option[] = [
  { id: "helpful_reminder", label: "Helpful reminder" },
  { id: "send_catalog", label: "Send product catalog (PDF)" },
  { id: "quote_follow_up", label: "Quote follow-up" },
  { id: "welcome_intro", label: "Welcome introduction" },
  { id: "last_chance", label: "Last-chance follow-up" },
];
const conditionFields = [["customer_replied", "Customer replied"], ["category_is", "Customer tag is"], ["opened_email", "Opened email"], ["clicked_link", "Clicked link"], ["company_status_is", "Company status is"], ["segment_is", "Company segment is"], ["country_is", "Company country is"], ["fit_score_at_least", "Fit score is at least"]] as const;
const conditionActions = [["stop_flow", "Stop workflow"], ["continue", "Continue"], ["skip_next", "Skip next step"]] as const;

const stepMeta: Record<FlowStepType, { icon: typeof Mail | typeof AiIcon; tone: string; group: "Message" | "Data" | "Logic"; description: string }> = {
  ai_auto_reply: { icon: AiIcon, tone: "bg-violet-50 text-violet-600 dark:bg-violet-500/10", group: "Message", description: "Read email and send a personalized reply" },
  send_email: { icon: Mail, tone: "bg-blue-50 text-blue-600 dark:bg-blue-500/10", group: "Message", description: "Send a tracked template" },
  create_task: { icon: UserRoundCheck, tone: "bg-amber-50 text-amber-600 dark:bg-amber-500/10", group: "Data", description: "Assign follow-up work" },
  change_category: { icon: Tag, tone: "bg-orange-50 text-orange-600 dark:bg-orange-500/10", group: "Data", description: "Update conversation state" },
  update_company: { icon: Building2, tone: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10", group: "Data", description: "Update company status or segment" },
  internal_alert: { icon: Bell, tone: "bg-rose-50 text-rose-600 dark:bg-rose-500/10", group: "Data", description: "Notify a teammate" },
  wait: { icon: Clock3, tone: "bg-slate-100 text-slate-600 dark:bg-slate-500/10", group: "Logic", description: "Delay the next action" },
  split: { icon: GitBranch, tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10", group: "Logic", description: "Route customers into ordered paths" },
  if_condition: { icon: GitBranch, tone: "bg-violet-50 text-violet-600 dark:bg-violet-500/10", group: "Logic", description: "Branch on engagement" },
  stop: { icon: CircleStop, tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/10", group: "Logic", description: "End the journey" },
};

const actionChoices: FlowActionChoice[] = stepTypes.filter((type) => type !== "if_condition").map((type) => { const meta = stepMeta[type], Icon = meta.icon; return { type, label: stepLabels[type], description: meta.description, group: meta.group, tone: meta.tone, icon: <Icon className="size-4" /> }; });

function toDraft(flow: AutomationFlow): DraftFlow {
  return { id: flow.id, name: flow.name, triggerType: flow.triggerType, triggerConfig: { ...flow.triggerConfig }, status: flow.status, activeRuns: flow.activeRuns, completedRuns: flow.completedRuns, updatedAt: flow.updatedAt, steps: flow.steps.map((step) => ({ id: step.id, type: step.type, config: { ...step.config } })) };
}

function newDraft(): DraftFlow {
  return { ...defaultFlowInput, id: null, name: "Untitled follow-up", status: "draft", activeRuns: 0, completedRuns: 0, triggerConfig: { ...defaultFlowInput.triggerConfig }, steps: defaultFlowInput.steps.map((step) => ({ ...step, id: crypto.randomUUID(), config: { ...step.config } })) };
}

function FlowSelect({ value, onChange, options, placeholder, disabled }: { value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[] | Option[]; placeholder?: string; disabled?: boolean }) {
  const normalized = options.map((option) => Array.isArray(option) ? { id: option[0], label: option[1] } : option) as Option[];
  const label = normalized.find((option) => option.id === value)?.label;
  return <Select value={value} onValueChange={(next) => next && onChange(next)} disabled={disabled}><SelectTrigger className="w-full"><SelectValue placeholder={placeholder}>{isCustomerTag(value) ? <CustomerTagLabel tag={value} /> : label}</SelectValue></SelectTrigger><SelectContent>{normalized.map((option) => <SelectItem key={option.id} value={option.id}>{isCustomerTag(option.id) ? <CustomerTagBadge tag={option.id} /> : option.label}</SelectItem>)}</SelectContent></Select>;
}

function AiReplyInspector({ config, onChange, mailboxes, disabled }: { config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; disabled: boolean }) {
  const set = (key: string, value: JsonConfig[string]) => onChange({ ...config, [key]: value });
  return <>
    <div className="rounded-lg bg-violet-50 p-3 text-xs leading-5 text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">Reads the latest customer email and conversation before sending. Leads without an email receive a welcome introduction.</div>
    <FlowSenderField value={String(config.mailboxId || "default")} onChange={(value) => set("mailboxId", value)} options={mailboxes} disabled={disabled} />
    <div className="space-y-2"><Label>Reply language</Label><p className="text-sm text-muted-foreground">English for every automated reply.</p></div>
    <div className="space-y-2"><Label>Reply instructions</Label><Textarea value={String(config.instructions || "")} onChange={(event) => set("instructions", event.target.value)} maxLength={4000} placeholder="Answer the customer's questions and ask about their required quantities." disabled={disabled} /></div>
    <div className="space-y-2">
      <ToggleField checked={Boolean(config.useProducts)} onChange={(value) => onChange({ ...config, useProducts: value, ...(!value ? { usePrices: false } : {}) })} label="Read product information" detail="Use active CRM products, variants, availability and specifications." disabled={disabled} />
      <ToggleField checked={Boolean(config.usePrices)} onChange={(value) => set("usePrices", value)} label="Use saved product prices" detail="Quote verified CRM prices with currency, minimum quantities and quantity breaks." disabled={disabled || !config.useProducts} />
      <ToggleField checked={Boolean(config.attachCatalog)} onChange={(value) => set("attachCatalog", value)} label="Attach product catalog PDF when needed" detail="Attach when requested or when AI identifies a clear product need. Specific product requests include only matching products." disabled={disabled} />
      {config.attachCatalog ? <ToggleField checked={config.catalogFirstMessageOnly !== false} onChange={(value) => set("catalogFirstMessageOnly", value)} label="Also include catalog in the first email" detail="Include it in the first automated email to this lead. Later emails attach only when needed. Customer refusals are respected." disabled={disabled} /> : null}
      <ToggleField checked={config.replyInThread !== false} onChange={(value) => set("replyInThread", value)} label="Reply in same thread" disabled={disabled} />
      <ToggleField checked={config.trackOpens !== false} onChange={(value) => set("trackOpens", value)} label="Track opens" disabled={disabled} />
      <ToggleField checked={config.trackClicks !== false} onChange={(value) => set("trackClicks", value)} label="Track link clicks" disabled={disabled} />
      <ToggleField checked={config.utmTracking !== false} onChange={(value) => set("utmTracking", value)} label="Add UTM tracking" disabled={disabled} />
    </div>
    <div className="space-y-2"><Label>Send window</Label><FlowSelect value={String(config.sendWindow || "anytime")} onChange={(value) => set("sendWindow", value)} options={[["anytime", "Any time"], ["business_hours", "Business hours (09:00–17:00 UTC)"]]} disabled={disabled} /></div>
    <p className="text-xs leading-5 text-muted-foreground">Sends automatically when this step runs. New customer replies are read, including replies received during a wait. Website/Meta inquiries and received customer emails can be answered without address verification. Unsubscribed, suppressed, invalid and risky addresses remain blocked.</p>
  </>;
}

function NumberInput({ value, onChange, min = 0, disabled }: { value: unknown; onChange: (value: number) => void; min?: number; disabled?: boolean }) {
  return <Input type="number" min={min} value={typeof value === "number" ? value : 0} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} />;
}

function statusVariant(status: FlowStatus) { return status === "live" ? "default" : status === "paused" ? "secondary" : "outline"; }
function titleCase(value: unknown) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function stepSummary(type: FlowStepType, config: JsonConfig) {
  if (type === "wait") return `Wait ${config.amount || 1} ${config.unit || "days"}${config.businessDays ? " · business time" : ""}`;
  if (type === "split") return `${Array.isArray(config.paths) ? config.paths.length : 0} ordered paths · first match wins`;
  if (type === "ai_auto_reply") return config.attachCatalog ? "English reply + catalog when needed" : "Personalized reply in English";
  if (type === "send_email") return templates.find((item) => item.id === config.templateId)?.label || "Choose an email template";
  if (type === "if_condition") return `${titleCase(config.field)} → ${titleCase(config.action)}`;
  if (type === "create_task") return String(config.title || "Create a CRM task");
  if (type === "change_category") return `Set tag to ${config.category || "…"}`;
  if (type === "update_company") return [config.companyStatus && `Status: ${titleCase(config.companyStatus)}`, config.segment && `Segment: ${config.segment}`].filter(Boolean).join(" · ") || "Choose company fields";
  if (type === "internal_alert") return String(config.message || "Notify a teammate");
  return "End this workflow";
}

function ToggleField({ checked, onChange, label, detail, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; detail?: string; disabled?: boolean }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/40"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} disabled={disabled} className="mt-0.5" /><span><span className="block text-sm font-medium">{label}</span>{detail ? <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{detail}</span> : null}</span></label>;
}

function TriggerInspector({ draft, setDraft, filterOptions = { segments: [], countries: [] }, disabled }: { draft: DraftFlow; setDraft: (flow: DraftFlow) => void; filterOptions?: FilterOptions; disabled: boolean }) {
  if (isSegmentAudienceFlow(draft.triggerType, draft.triggerConfig)) return <div className="space-y-5">
    <div><p className="text-sm font-semibold">Segment trigger is ready</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Your segment already defines the customers. Add actions to choose what happens next.</p></div>
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4"><p className="text-xs font-medium text-muted-foreground">{draft.triggerConfig.savedSegmentId ? "Saved segment" : "Business segment"}</p><p data-no-translate className="mt-2 break-words text-sm font-semibold">{String(draft.triggerConfig.segment)}</p><Link href={segmentCompaniesHref(draft.triggerConfig)} className="mt-3 inline-flex text-xs font-medium text-primary">View customers in this segment</Link></div>
    <p className="text-xs leading-5 text-muted-foreground">After you turn on this workflow, existing and newly matching companies enter on the next automation check. Membership follows the segment&apos;s current rules and selected companies.</p>
  </div>;
  const configs: Record<TriggerType, JsonConfig> = { new_lead: { reentryMode: "no_reentry" }, email_received: { reentryMode: "every_event" }, category_changed: { category: "Quotation Follow-up", reentryMode: "every_event" }, no_reply: { amount: 2, unit: "days", businessDays: true, reentryMode: "after_period", reentryAfterAmount: 30, reentryAfterUnit: "days" }, lead_added_to_list: { listId: "Shopify B2B leads", reentryMode: "no_reentry" }, company_segment_changed: { segment: filterOptions.segments[0] || "Shopify B2B lead", reentryMode: "after_period", reentryAfterAmount: 30, reentryAfterUnit: "days" }, pipeline_stage_changed: { stage: "new", reentryMode: "every_event" } };
  const updateConfig = (key: string, value: string | number | boolean | null) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, [key]: value } });
  const updateOptional = (key: string, value: string) => { const next = { ...draft.triggerConfig }; if (value === "__any") delete next[key]; else next[key] = value; setDraft({ ...draft, triggerConfig: next }); };
  const businessSegments = [...new Set([String(draft.triggerConfig.segment || ""), ...filterOptions.segments])].filter(Boolean);
  const segmentOptions = [{ id: "__any", label: "Any segment" }, ...businessSegments.map((value) => ({ id: value, label: value }))];
  const countryOptions = [{ id: "__any", label: "Any country" }, ...filterOptions.countries.map((value) => ({ id: value, label: value }))];
  return <div className="space-y-5"><div><p className="text-sm font-semibold">Journey trigger</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the real CRM event that enrolls a contact.</p></div><div className="space-y-2"><Label>Trigger event</Label><FlowSelect value={draft.triggerType} onChange={(value) => { const type = value as TriggerType; setDraft({ ...draft, triggerType: type, triggerConfig: { ...configs[type], ...emailFlowScope(draft.triggerConfig), ...("contactIds" in draft.triggerConfig ? { contactIds: draft.triggerConfig.contactIds } : {}) } }); }} options={triggerTypes.filter(value => value !== "pipeline_stage_changed").map((value) => [value, triggerLabels[value]] as const)} disabled={disabled} /></div>{draft.triggerType === "category_changed" ? <div className="space-y-2"><Label>Customer tag</Label><FlowSelect value={String(draft.triggerConfig.category || "Quotation Follow-up")} onChange={(value) => updateConfig("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div> : null}{draft.triggerType === "no_reply" ? <><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Duration</Label><NumberInput min={1} value={draft.triggerConfig.amount} onChange={(value) => updateConfig("amount", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Unit</Label><FlowSelect value={String(draft.triggerConfig.unit || "days")} onChange={(value) => updateConfig("unit", value)} options={[["hours", "Hours"], ["days", "Days"]]} disabled={disabled} /></div></div><ToggleField checked={Boolean(draft.triggerConfig.businessDays)} onChange={(value) => updateConfig("businessDays", value)} label="Count business days only" detail="Skip weekends when evaluating the trigger." disabled={disabled} /></> : null}{draft.triggerType === "lead_added_to_list" ? <div className="space-y-2"><Label>Lead list</Label><FlowSelect value={String(draft.triggerConfig.listId || "Shopify B2B leads")} onChange={(value) => updateConfig("listId", value)} options={flowLeadLists.map(value => [value, value] as const)} disabled={disabled} /></div> : null}{draft.triggerType === "company_segment_changed" ? <div className="space-y-2"><Label>Company segment</Label>{businessSegments.length ? <FlowSelect value={String(draft.triggerConfig.segment || businessSegments[0])} onChange={(value) => updateConfig("segment", value)} options={businessSegments.map((value) => ({ id: value, label: value }))} disabled={disabled} /> : <Input value={String(draft.triggerConfig.segment || "")} onChange={(event) => updateConfig("segment", event.target.value)} placeholder="Enter a CRM segment" disabled={disabled} />}</div> : null}{draft.triggerType === "pipeline_stage_changed" ? <span hidden /> : null}{draft.triggerConfig.flowScope ? <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-5"><p className="font-semibold">{draft.triggerConfig.flowScope === "company" ? "Only this company" : "Only this email address"}</p><p className="mt-1 break-all">{String(draft.triggerConfig.scopeLabel)}</p><p className="mt-1 text-muted-foreground">This recipient scope stays fixed when you customize the trigger and actions. Enrollment starts when the selected event occurs.</p></div> : <FlowCustomerPicker config={draft.triggerConfig} onChange={(triggerConfig) => setDraft({ ...draft, triggerConfig })} disabled={disabled} />}<div className="space-y-3 border-t pt-4"><div><p className="text-xs font-semibold">Company filters</p><p className="mt-1 text-xs text-muted-foreground">All selected filters must match before enrollment.</p></div>{draft.triggerType !== "company_segment_changed" ? <div className="space-y-2"><Label>Segment</Label><FlowSelect value={String(draft.triggerConfig.segment || "__any")} onChange={(value) => updateOptional("segment", value)} options={segmentOptions} disabled={disabled} /></div> : null}<div className="space-y-2"><Label>Country</Label><FlowSelect value={String(draft.triggerConfig.country || "__any")} onChange={(value) => updateOptional("country", value)} options={countryOptions} disabled={disabled} /></div><div className="space-y-2"><Label>Company status</Label><FlowSelect value={String(draft.triggerConfig.companyStatus || "__any")} onChange={(value) => updateOptional("companyStatus", value)} options={[{ id: "__any", label: "Any status" }, ...companyStatuses.map((value) => ({ id: value, label: titleCase(value) }))]} disabled={disabled} /></div><span hidden /><div className="space-y-2"><Label>Minimum fit score</Label><NumberInput min={0} value={draft.triggerConfig.minFitScore ?? 0} onChange={(value) => { const next = { ...draft.triggerConfig }; if (value <= 0) delete next.minFitScore; else next.minFitScore = value; setDraft({ ...draft, triggerConfig: next }); }} disabled={disabled} /></div></div><div className="rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Enrollment:</strong> Each conversation can have only one active run in this workflow.</div></div>;
}

function ReentrySettings({ draft, setDraft, disabled }: { draft: DraftFlow; setDraft: (flow: DraftFlow) => void; disabled: boolean }) {
  if (isSegmentAudienceFlow(draft.triggerType, draft.triggerConfig)) return <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground">Each company can enter this segment workflow once.</p>;
  const config = draft.triggerConfig;
  const set = (key: string, value: JsonConfig[string]) => setDraft({ ...draft, triggerConfig: { ...config, [key]: value } });
  const mode = String(config.reentryMode || "every_event");
  return <div className="mt-5 space-y-3 border-t pt-4"><div><p className="text-xs font-semibold">Re-entry criteria</p><p className="mt-1 text-xs text-muted-foreground">Control whether the same customer can enter this workflow again.</p></div><FlowSelect value={mode} onChange={(value) => set("reentryMode", value)} options={[["no_reentry", "No re-entry"], ["every_event", "Allow every matching event"], ["after_period", "Allow after a waiting period"]]} disabled={disabled} />{mode === "after_period" ? <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Wait</Label><NumberInput min={1} value={config.reentryAfterAmount ?? 30} onChange={(value) => set("reentryAfterAmount", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Unit</Label><FlowSelect value={String(config.reentryAfterUnit || "days")} onChange={(value) => set("reentryAfterUnit", value)} options={[["hours", "Hours"], ["days", "Days"]]} disabled={disabled} /></div></div> : null}</div>;
}

function BaseStepInspector({ type, config, onChange, mailboxes, members, disabled }: { type: FlowStepType; config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; members: Option[]; disabled: boolean }) {
  const set = (key: string, value: string | number | boolean | null) => onChange({ ...config, [key]: value });
  return <div className="space-y-5"><div><p className="text-sm font-semibold">{stepLabels[type]}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{stepMeta[type].description}</p></div>{type === "ai_auto_reply" ? <AiReplyInspector config={config} onChange={onChange} mailboxes={mailboxes} disabled={disabled} /> : null}{type === "wait" ? <><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Duration</Label><NumberInput min={1} value={config.amount} onChange={(value) => set("amount", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Unit</Label><FlowSelect value={String(config.unit || "days")} onChange={(value) => onChange({ ...config, unit: value, ...(value !== "days" ? { businessDays: false, resumeAt: "" } : {}) })} options={[["minutes", "Minutes"], ["hours", "Hours"], ["days", "Days"]]} disabled={disabled} /></div></div><ToggleField checked={Boolean(config.businessDays)} onChange={(value) => set("businessDays", value)} label="Business days only" detail="Skip Saturday and Sunday." disabled={disabled} /><div className="space-y-2"><Label>Resume at (UTC, optional)</Label><Input type="time" value={String(config.resumeAt ?? "")} onChange={(event) => set("resumeAt", event.target.value)} disabled={disabled} /></div></> : null}{type === "if_condition" ? <><div className="space-y-2"><Label>Condition</Label><FlowSelect value={String(config.field || "customer_replied")} onChange={(value) => onChange({ ...config, field: value, ...(value === "category_is" && !config.category ? { category: "Quotation Follow-up" } : {}) })} options={conditionFields} disabled={disabled} /></div>{config.field === "category_is" ? <div className="space-y-2"><Label>Category</Label><FlowSelect value={String(config.category || "Quotation Follow-up")} onChange={(value) => set("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div> : null}<div className="space-y-2"><Label>Lookback window</Label><div className="flex items-center gap-2"><NumberInput min={1} value={config.lookbackDays ?? 7} onChange={(value) => set("lookbackDays", value)} disabled={disabled} /><span className="text-xs text-muted-foreground">days</span></div></div><div className="space-y-2"><Label>If matched</Label><FlowSelect value={String(config.action || "stop_flow")} onChange={(value) => set("action", value)} options={conditionActions} disabled={disabled} /></div></> : null}{type === "send_email" ? <><div className="space-y-2"><Label>Email template</Label><FlowSelect value={String(config.templateId || "")} onChange={(value) => set("templateId", value)} options={templates} placeholder="Choose a template" disabled={disabled} /></div><FlowSenderField value={String(config.mailboxId || "default")} onChange={(value) => set("mailboxId", value)} options={mailboxes} disabled={disabled} /><div className="space-y-2"><Label>Subject override</Label><Input value={String(config.subject || "")} onChange={(event) => set("subject", event.target.value)} placeholder="Use template subject" disabled={disabled} /></div><div className="space-y-2"><Label>Message override (optional)</Label><Textarea value={String(config.body || "")} onChange={(event) => { const next = { ...config }; if (event.target.value.trim()) next.body = event.target.value; else delete next.body; onChange(next); }} placeholder="Use template message. Supports {{first_name}} and https:// links." disabled={disabled} /></div><div className="space-y-2"><Label>Preheader</Label><Input value={String(config.preheader || "")} onChange={(event) => set("preheader", event.target.value)} placeholder="Inbox preview text" disabled={disabled} /></div><div className="space-y-2"><Label>Send window</Label><FlowSelect value={String(config.sendWindow || "business_hours")} onChange={(value) => set("sendWindow", value)} options={[["business_hours", "Business hours (09:00–17:00 UTC)"], ["anytime", "Any time"]]} disabled={disabled} /></div><div className="space-y-2"><ToggleField checked={Boolean(config.replyInThread)} onChange={(value) => set("replyInThread", value)} label="Reply in same thread" disabled={disabled} /><ToggleField checked={config.trackOpens !== false} onChange={(value) => set("trackOpens", value)} label="Track opens" disabled={disabled} /><ToggleField checked={config.trackClicks !== false} onChange={(value) => set("trackClicks", value)} label="Track link clicks" disabled={disabled} /><ToggleField checked={config.utmTracking !== false} onChange={(value) => set("utmTracking", value)} label="Add UTM tracking" disabled={disabled} /><ToggleField checked={config.stopOnReply !== false} onChange={(value) => set("stopOnReply", value)} label="Stop if customer replies" disabled={disabled} /></div></> : null}{type === "create_task" ? <><div className="space-y-2"><Label>Task title</Label><Input value={String(config.title || "")} onChange={(event) => set("title", event.target.value)} disabled={disabled} /></div><div className="space-y-2"><Label>Assign to</Label><FlowSelect value={String(config.assigneeType || "owner")} onChange={(value) => set("assigneeType", value)} options={[["owner", "Conversation owner"], ["user", "Specific user"]]} disabled={disabled} /></div>{config.assigneeType === "user" ? <div className="space-y-2"><Label>Team member</Label><FlowSelect value={String(config.assigneeId || "")} onChange={(value) => set("assigneeId", value)} options={members} placeholder="Choose a user" disabled={disabled} /></div> : null}<div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Due in days</Label><NumberInput value={config.dueInDays} onChange={(value) => set("dueInDays", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Priority</Label><FlowSelect value={String(config.priority || "normal")} onChange={(value) => set("priority", value)} options={[["low", "Low"], ["normal", "Normal"], ["high", "High"]]} disabled={disabled} /></div></div><div className="space-y-2"><Label>Notes</Label><Textarea value={String(config.notes || "")} onChange={(event) => set("notes", event.target.value)} placeholder="Instructions for the assignee" disabled={disabled} /></div></> : null}{type === "change_category" ? <><div className="space-y-2"><Label>New tag</Label><FlowSelect value={String(config.category || "Quotation Follow-up")} onChange={(value) => set("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div><div className="space-y-2"><Label>Internal reason</Label><Textarea value={String(config.reason || "")} onChange={(event) => set("reason", event.target.value)} placeholder="Why this tag is applied" disabled={disabled} /></div></> : null}{type === "internal_alert" ? <><div className="space-y-2"><Label>Notify</Label><FlowSelect value={String(config.userId || "owner")} onChange={(value) => set("userId", value)} options={[{ id: "owner", label: "Conversation owner" }, ...members]} disabled={disabled} /></div><div className="space-y-2"><Label>Delivery</Label><FlowSelect value={String(config.channel || "in_app")} onChange={(value) => set("channel", value)} options={[["in_app", "In-app notification"], ["email", "Email notification"]]} disabled={disabled} /></div>{config.channel === "email" ? <FlowSenderField value={String(config.mailboxId || "default")} onChange={(value) => set("mailboxId", value)} options={mailboxes} disabled={disabled} /> : null}<div className="space-y-2"><Label>Message</Label><Textarea value={String(config.message || "")} onChange={(event) => set("message", event.target.value)} disabled={disabled} /></div><ToggleField checked={config.includeThreadLink !== false} onChange={(value) => set("includeThreadLink", value)} label="Include conversation link" disabled={disabled} /></> : null}{type === "stop" ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Contacts reaching this step leave the workflow immediately. Later steps will not run.</div> : null}</div>;
}

function B2bConditionFields({ config, set, disabled }: { config: JsonConfig; set: (key: string, value: string | number | boolean | null) => void; disabled: boolean }) {
  if (config.field === "company_status_is") return <div className="mt-5 space-y-2"><Label>Company status</Label><FlowSelect value={String(config.companyStatus || "engaged")} onChange={(value) => set("companyStatus", value)} options={companyStatuses.map((value) => [value, titleCase(value)] as const)} disabled={disabled} /></div>;
  if (config.field === "segment_is" || config.field === "country_is") return <div className="mt-5 space-y-2"><Label>{config.field === "segment_is" ? "Company segment" : "Country"}</Label><Input value={String(config.value || "")} onChange={(event) => set("value", event.target.value)} disabled={disabled} /></div>;
  if (config.field === "fit_score_at_least") return <div className="mt-5 space-y-2"><Label>Minimum fit score (1–10)</Label><NumberInput min={1} value={config.fitScore ?? 7} onChange={(value) => set("fitScore", Math.min(10, value))} disabled={disabled} /></div>;
  return null;
}

function UpdateCompanyFields({ config, onChange, disabled }: { config: JsonConfig; onChange: (config: JsonConfig) => void; disabled: boolean }) {
  const optional = (key: string, value: string) => { const next = { ...config }; if (value === "__unchanged") delete next[key]; else next[key] = value; onChange(next); };
  return <div className="mt-5 space-y-4"><div className="rounded-lg bg-cyan-50 p-3 text-xs leading-5 text-cyan-900 dark:bg-cyan-500/10 dark:text-cyan-200">Apply one or more B2B CRM updates when this action runs. Unchanged fields keep their current values.</div><div className="space-y-2"><Label>Company status</Label><FlowSelect value={String(config.companyStatus || "__unchanged")} onChange={(value) => optional("companyStatus", value)} options={[["__unchanged", "Leave unchanged"], ...companyStatuses.map((value) => [value, titleCase(value)] as const)]} disabled={disabled} /></div><span hidden /><div className="space-y-2"><Label>Company segment</Label><Input value={String(config.segment || "")} onChange={(event) => optional("segment", event.target.value || "__unchanged")} placeholder="Leave unchanged" disabled={disabled} /></div><div className="space-y-2"><Label>Activity note</Label><Textarea value={String(config.note || "")} onChange={(event) => optional("note", event.target.value || "__unchanged")} placeholder="Why the automation made this update" disabled={disabled} /></div></div>;
}

type SplitPath = { id: string; name: string; condition: JsonConfig | null; steps: FlowInput["steps"] };
function splitPaths(config: JsonConfig) { return (Array.isArray(config.paths) ? config.paths : []) as unknown as SplitPath[]; }

function conditionSummary(config: JsonConfig): string {
  if (Array.isArray(config.rules)) return config.rules.map((rule) => conditionSummary(rule as JsonConfig)).join(config.match === "any" ? " OR " : " AND ");
  const label = conditionFields.find(([field]) => field === config.field)?.[1] || "Path criteria";
  const value = config.category || config.companyStatus || config.value || config.fitScore;
  return `${label}${value ? ` ${titleCase(value)}` : ""}${config.negate ? " · not matched" : ""}`;
}

function SplitInspector({ config, onChange, disabled }: { config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; members: Option[]; disabled: boolean }) {
  const paths = splitPaths(config);
  const updatePaths = (next: SplitPath[]) => onChange({ ...config, paths: next as unknown as JsonConfig["paths"] });
  const updatePath = (index: number, next: SplitPath) => updatePaths(paths.map((path, pathIndex) => pathIndex === index ? next : path));
  return <div className="mt-5 space-y-5"><p className="text-xs leading-5 text-muted-foreground">Paths are checked from top to bottom. Each customer enters the first matching path; Everyone else is always last.</p><Label className="grid gap-2">Split name<Input value={String(config.name || "")} onChange={(event) => onChange({ ...config, name: event.target.value })} disabled={disabled} /></Label><div className="flex items-center justify-between"><p className="text-xs font-semibold">Paths ({paths.length} of 20)</p>{paths.length === 2 ? <Button size="sm" variant="ghost" disabled={disabled} onClick={() => updatePaths([{ ...paths[0], steps: paths[1].steps }, { ...paths[1], steps: paths[0].steps }])}>Flip path actions</Button> : null}</div>{paths.map((path, pathIndex) => <Card key={path.id} className="gap-4 p-4"><div className="flex items-center gap-2"><Badge variant="secondary">{pathIndex + 1}</Badge><Input aria-label={`Path ${pathIndex + 1} name`} value={path.name} onChange={(event) => updatePath(pathIndex, { ...path, name: event.target.value })} disabled={disabled || path.condition === null} className="h-8 font-semibold" />{path.condition !== null ? <div className="flex"><Button variant="ghost" size="icon-xs" aria-label="Move path up" disabled={disabled || pathIndex === 0} onClick={() => updatePaths(reorderFlowSteps(paths, pathIndex, pathIndex - 1))}><ArrowUp /></Button><Button variant="ghost" size="icon-xs" aria-label="Move path down" disabled={disabled || pathIndex >= paths.length - 2} onClick={() => updatePaths(reorderFlowSteps(paths, pathIndex, pathIndex + 1))}><ArrowDown /></Button>{paths.length > 2 ? <Button variant="ghost" size="icon-xs" aria-label={`Remove ${path.name}`} disabled={disabled} onClick={() => updatePaths(paths.filter((_, i) => i !== pathIndex))}><Trash2 /></Button> : null}</div> : null}</div>{path.condition ? <FlowConditionEditor config={path.condition} onChange={(condition) => updatePath(pathIndex, { ...path, condition })} disabled={disabled} /> : <p className="text-xs leading-5 text-muted-foreground">Customers who do not match an earlier path enter here.</p>}<p className="text-xs text-muted-foreground">{path.steps.length} path actions · Select an action on the canvas to edit it.</p></Card>)}<Button type="button" variant="outline" onClick={() => updatePaths([...paths.slice(0, -1), { id: crypto.randomUUID(), name: `Path ${paths.length}`, condition: { field: "customer_replied" }, steps: [] }, paths.at(-1)!])} disabled={disabled || paths.length >= 20}><Plus />Add path</Button></div>;
}

function StepInspector(props: { type: FlowStepType; config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; members: Option[]; disabled: boolean }) {
  const { type, config, onChange, disabled } = props;
  const set = (key: string, value: string | number | boolean | null) => onChange({ ...config, [key]: value });
  return <div><BaseStepInspector {...props} />{["send_email", "ai_auto_reply"].includes(type) ? <div className="mt-5 space-y-5 border-t pt-5"><div className="space-y-3"><ToggleField checked={Number(config.smartSendingHours) > 0} onChange={(checked) => set("smartSendingHours", checked ? 16 : 0)} label="Skip recently emailed customers" detail="Checks messages sent by this workflow's owner across their workflows and mailbox." disabled={disabled} />{Number(config.smartSendingHours) > 0 ? <Label className="grid gap-2">Smart Sending window (hours)<NumberInput min={1} value={config.smartSendingHours} onChange={(value) => set("smartSendingHours", Math.min(720, value))} disabled={disabled} /></Label> : null}</div><div className="space-y-3"><p className="text-xs font-semibold">Additional message filters</p><p className="text-xs leading-5 text-muted-foreground">Checked again when this message is due. A failed filter skips this message and continues the journey.</p>{config.filters && typeof config.filters === "object" && !Array.isArray(config.filters) ? <><FlowConditionEditor config={config.filters} onChange={(filters) => onChange({ ...config, filters })} disabled={disabled} /><Button size="sm" variant="ghost" onClick={() => { const next = { ...config }; delete next.filters; onChange(next); }} disabled={disabled}>Remove message filters</Button></> : <Button variant="outline" size="sm" onClick={() => onChange({ ...config, filters: { field: "customer_replied", negate: true } })} disabled={disabled}><Plus />Add message filter</Button>}</div></div> : null}{type === "split" ? <SplitInspector config={config} onChange={onChange} mailboxes={props.mailboxes} members={props.members} disabled={disabled} /> : null}{type === "if_condition" ? <><B2bConditionFields config={config} set={set} disabled={disabled} /><div className="mt-5 space-y-2"><Label>If not matched</Label><FlowSelect value={String(config.unmatchedAction || "continue")} onChange={(value) => set("unmatchedAction", value)} options={conditionActions} disabled={disabled} /></div></> : null}{type === "update_company" ? <UpdateCompanyFields config={config} onChange={onChange} disabled={disabled} /> : null}{type === "stop" ? <div className="mt-5 space-y-4"><div className="space-y-2"><Label>Reason</Label><Input value={String(config.reason || "")} onChange={(event) => set("reason", event.target.value)} placeholder="Why the automation ends here" disabled={disabled} /></div><div className="space-y-2"><Label>Run outcome</Label><FlowSelect value={String(config.outcome || "completed")} onChange={(value) => set("outcome", value)} options={[["completed", "Completed"], ["cancelled", "Cancelled"]]} disabled={disabled} /></div></div> : null}</div>;
}


type FlowActionPaletteProps = {
  canEdit: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  actions: FlowStepType[];
  onAdd: (type: FlowStepType) => void;
  onAudit: () => void;
};

function FlowPaletteAction({ type, canEdit, onAdd }: { type: FlowStepType; canEdit: boolean; onAdd: (type: FlowStepType) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette-${type}`, data: { flowStepType: type }, disabled: !canEdit });
  const { icon: Icon, tone, description } = stepMeta[type];
  return <button ref={setNodeRef} type="button" {...attributes} {...listeners} onClick={() => onAdd(type)} disabled={!canEdit} className={`flex w-full touch-none cursor-grab items-center gap-2.5 rounded-lg px-2 py-2.5 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 ${isDragging ? "opacity-50" : ""}`}>
    <span className={"grid size-9 shrink-0 place-items-center rounded-lg " + tone}><Icon className="size-4" /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium leading-5">{stepLabels[type]}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span></span>
    <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
  </button>;
}

function FlowPaletteOverlay() {
  const { active } = useDndContext();
  const type = active?.data.current?.flowStepType as FlowStepType | undefined;
  const meta = type && stepMeta[type];
  const Icon = meta?.icon;
  return <DragOverlay dropAnimation={null}>{type && meta && Icon ? <div className="pointer-events-none flex w-60 items-center gap-3 rounded-xl border bg-background p-3 shadow-xl"><span className={`grid size-9 shrink-0 place-items-center rounded-lg ${meta.tone}`}><Icon className="size-5" /></span><span className="text-sm font-semibold">{stepLabels[type]}</span></div> : null}</DragOverlay>;
}

function FlowActionPalette({ canEdit, query, onQueryChange, actions, onAdd, onAudit }: FlowActionPaletteProps) {
  return (
    <aside aria-label="Workflow actions" className="scroll-surface hidden min-h-0 w-64 shrink-0 overflow-y-auto border-r bg-background p-4 min-[100rem]:block">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-body font-semibold">Actions</h2>
          <p className="mt-1 text-xs text-muted-foreground">Drag to canvas or click to add</p>
        </div>
        <Workflow className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input aria-label="Find a workflow action" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Find an action" className="pl-9" />
      </div>
      {(["Message", "Data", "Logic"] as const).map((group) => {
        const groupActions = actions.filter((type) => stepMeta[type].group === group);
        if (!groupActions.length) return null;
        return (
          <section key={group} className="mb-5" aria-label={group + " actions"}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
            <div className="space-y-1">
              {groupActions.map((type) => <FlowPaletteAction key={type} type={type} canEdit={canEdit} onAdd={onAdd} />)}
            </div>
          </section>
        );
      })}
      {!actions.length ? <EmptyState compact icon={Search} title="No matching actions." className="border-0 bg-transparent" /> : null}
      <Button variant="secondary" onClick={onAudit} className="mt-4 w-full text-violet-700 dark:text-violet-300">
        <AiIcon  />Audit this workflow
      </Button>
    </aside>
  );
}

type CanvasDragProps = { dropTarget?: FlowDropTarget | null; onActionPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, id: string) => void; onInsertAction?: (type: FlowStepType, target: FlowDropTarget) => void };
type FlowDragInput = { type: FlowStepType } | { actionId: string };

function SplitCanvasNode({ step, index, selected, onSelect, onMove, onRemove, onPointerDown, disabled, last, selection, onSelectAction, onChange, preview, dropTarget, onActionPointerDown, onInsertAction }: {
  step: FlowInput["steps"][number]; index: number; selected: boolean; onSelect: () => void;
  onMove: (offset: number) => void; onRemove: () => void; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  disabled: boolean; last: boolean; selection?: string; onSelectAction?: (id: string) => void;
  onChange?: (config: JsonConfig) => void; preview?: FlowPreviewResult | null;
} & CanvasDragProps) {
  const paths = splitPaths(step.config);
  const columnWidths = paths.map((path) => Math.max(360, ...path.steps.map(flowNodeWidth)));
  const width = columnWidths.reduce((sum, value) => sum + value, 0) + (paths.length - 1) * FLOW_BRANCH_GAP;
  const updatePath = (pathIndex: number, next: SplitPath) => onChange?.({ ...step.config, paths: paths.map((path, i) => i === pathIndex ? next : path) as unknown as JsonConfig["paths"] });
  const add = (pathIndex: number, position: number, type: FlowStepType) => {
    onInsertAction?.(type, { branchId: paths[pathIndex].id, index: position });
  };
  const insert = (pathIndex: number, position: number) => <div data-flow-branch-insert-index={position} data-flow-drop-indicator={dropTarget?.branchId === paths[pathIndex].id && dropTarget.index === position ? "" : undefined} className="relative z-20 flex h-14 justify-center before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-border">{dropTarget?.branchId === paths[pathIndex].id && dropTarget.index === position ? <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-2"><span className="h-0.5 flex-1 bg-primary" /><span className="rounded-full border border-primary bg-background px-3 py-1 text-xs font-semibold text-primary shadow-sm">Drop here</span><span className="h-0.5 flex-1 bg-primary" /></div> : null}<FlowActionPicker items={actionChoices} context={paths[pathIndex].name} label={`Add action to ${paths[pathIndex].name} at position ${position + 1}`} disabled={disabled || paths[pathIndex].steps.length >= 25} onAdd={(type) => add(pathIndex, position, type)} /></div>;
  return <div>
    <FlowActionCard split label={String(step.config.name || "Split")} summary="Checks paths in order · first match wins" icon={<GitBranch className="size-[18px]" />} tone={stepMeta.split.tone} index={index} selected={selected} disabled={disabled} last={last} onSelect={onSelect} onMove={onMove} onRemove={onRemove} onPointerDown={onPointerDown} />
    <div className="mx-auto h-8 w-px bg-border" />
    <div data-no-drag data-flow-split-branches className="relative grid items-stretch" style={{ gap: FLOW_BRANCH_GAP, width, marginLeft: `calc((100% - ${width}px) / 2)`, gridTemplateColumns: columnWidths.map((value) => `${value}px`).join(" ") }}>
      <div className="absolute top-0 h-px bg-border" style={{ left: columnWidths[0] / 2, right: columnWidths.at(-1)! / 2 }} />
      {paths.map((path, pathIndex) => {
        const reached = !preview || preview.trace.some((entry) => entry.pathId === path.id);
        return <div key={path.id} data-flow-branch-id={path.id} className={`relative flex min-w-0 flex-col pt-6 before:absolute before:left-1/2 before:top-0 before:h-6 before:w-px before:bg-border ${reached ? "" : "opacity-35"}`}>
          <button data-flow-path-header type="button" onClick={onSelect} title={path.condition === null ? "Customers who do not match an earlier path enter here." : conditionSummary(path.condition)} className={`group/path flex h-[104px] w-full flex-col rounded-xl border p-3.5 text-left transition-colors hover:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${path.condition === null ? "border-border bg-muted/40" : "border-indigo-200/70 bg-indigo-50/60 dark:border-indigo-400/25 dark:bg-indigo-400/5"} ${preview && reached ? "ring-2 ring-primary/25" : ""}`}><div className="flex w-full items-center gap-2"><span className={`grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-semibold ${path.condition === null ? "bg-muted text-muted-foreground" : "bg-indigo-100 text-indigo-600 dark:bg-indigo-400/20 dark:text-indigo-300"}`}>{pathIndex + 1}</span><p className="min-w-0 flex-1 truncate text-xs font-semibold">{path.name}</p><span className="text-[10px] font-medium text-muted-foreground">{path.condition === null ? "Otherwise" : pathIndex === 0 ? "Check first" : "Check next"}</span><Settings2 className="size-3 shrink-0 text-muted-foreground opacity-40 group-hover/path:opacity-100" /></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{path.condition === null ? "Customers who do not match an earlier path enter here." : conditionSummary(path.condition)}</p><span className="sr-only">{path.condition === null ? "Path settings" : "Edit path criteria"}</span></button>
          {path.steps.map((action, actionIndex) => <div key={action.id || actionIndex}>{insert(pathIndex, actionIndex)}<div data-flow-action-id={action.id}><FlowNode step={action} index={actionIndex} selected={selection === action.id} onSelect={() => onSelectAction?.(action.id!)} onPointerDown={(event) => onActionPointerDown?.(event, action.id!)} dropTarget={dropTarget} onActionPointerDown={onActionPointerDown} onInsertAction={onInsertAction} onMove={(offset) => updatePath(pathIndex, { ...path, steps: reorderFlowSteps(path.steps, actionIndex, actionIndex + offset) })} onRemove={() => { updatePath(pathIndex, { ...path, steps: path.steps.filter((_, i) => i !== actionIndex) }); onSelect(); }} disabled={disabled} last={actionIndex === path.steps.length - 1} selection={selection} onSelectAction={onSelectAction} preview={preview} onSplitChange={(config) => updatePath(pathIndex, { ...path, steps: path.steps.map((item, i) => i === actionIndex ? { ...item, config } : item) })} /></div></div>)}
          {insert(pathIndex, path.steps.length)}
          <div className="mt-auto space-y-2 pb-6 text-center"><span className="inline-flex items-center gap-1.5 bg-background px-2 py-1 text-[11px] text-muted-foreground">{path.steps.at(-1)?.type === "stop" ? "Workflow ends here" : "Continue after split"}</span><div className={`mx-auto h-6 w-px ${path.steps.at(-1)?.type === "stop" ? "bg-transparent" : "bg-border"}`} /></div>
        </div>;
      })}
      <div className="absolute bottom-0 h-px bg-border" style={{ left: columnWidths[0] / 2, right: columnWidths.at(-1)! / 2 }} />
    </div>
    <div className="mx-auto h-6 w-px bg-border" />
  </div>;
}

function FlowNode({ step, index, selected, onSelect, onMove, onRemove, onPointerDown, disabled, last, selection, onSelectAction, onSplitChange, preview, dropTarget, onActionPointerDown, onInsertAction }: { selection?: string; onSelectAction?: (id: string) => void; onSplitChange?: (config: JsonConfig) => void; preview?: FlowPreviewResult | null; step: FlowInput["steps"][number]; index: number; selected: boolean; onSelect: () => void; onMove: (offset: number) => void; onRemove: () => void; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void; disabled: boolean; last: boolean } & CanvasDragProps) {
  const meta = stepMeta[step.type]; const Icon = meta.icon;
  if (step.type === "split") return <SplitCanvasNode step={step} index={index} selected={selected} onSelect={onSelect} onMove={onMove} onRemove={onRemove} onPointerDown={onPointerDown} disabled={disabled} last={last} selection={selection} onSelectAction={onSelectAction} onChange={onSplitChange} preview={preview} dropTarget={dropTarget} onActionPointerDown={onActionPointerDown} onInsertAction={onInsertAction} />;
  return <FlowActionCard label={stepLabels[step.type]} summary={stepSummary(step.type, step.config)} icon={<Icon className="size-[18px]" />} tone={meta.tone} index={index} selected={selected} disabled={disabled} last={last} onSelect={onSelect} onMove={onMove} onRemove={onRemove} onPointerDown={onPointerDown} />;
}

function FlowCanvas({ draft, selection, insertAt, canEdit, setSelection, setInsertAt, onAddStep, onMoveStep, onRemoveStep, onUpdateStep, preview, onDropFlowAction, onNavigate }: { onNavigate: (id: string) => void; onDropFlowAction: (input: FlowDragInput, target: FlowDropTarget) => void; onUpdateStep: (index: number, config: JsonConfig) => void; preview?: FlowPreviewResult | null; draft: DraftFlow; selection: Selection; insertAt: number | null; canEdit: boolean; setSelection: (selection: Selection) => void; setInsertAt: (position: number | null) => void; onAddStep: (type: FlowStepType, position?: number) => FlowInput["steps"][number] | null; onMoveStep: (index: number, offset: number) => void; onRemoveStep: (index: number) => void }) {
  const viewportRef = useRef<HTMLElement>(null);
  const { setNodeRef } = useDroppable({ id: "flow-canvas", disabled: !canEdit });
  const setViewportRef = useCallback((node: HTMLElement | null) => {
    viewportRef.current = node;
    setNodeRef(node);
  }, [setNodeRef]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<CanvasPoint>({ x: 0, y: 0 });
  const [nodeWidth, setNodeWidth] = useState(CANVAS_NODE_WIDTH);
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const nodeKeys = draft.steps.map((step, index) => step.id || `step-${index}`).join(",");
  const [panning, setPanning] = useState(false);
  const [dropTarget, setDropTarget] = useState<FlowDropTarget | null>(null);
  const paletteDropIndex = dropTarget?.branchId === null ? dropTarget.index : null;
  const [dragPreview, setDragPreview] = useState<{ id: string; position: CanvasPoint } | null>(null);
  const panRef = useRef<{ start: CanvasPoint; origin: CanvasPoint } | null>(null);
  const dragRef = useRef<{ id: string; start: CanvasPoint; element: HTMLDivElement; pointerId: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const previousViewportWidth = useRef(0);
  const triggerId = "__trigger";
  const endId = "__end";

  useEffect(() => {
    const cancel = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
      suppressClickRef.current = drag.moved;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      setDragPreview(null);
      setDropTarget(null);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", keydown);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("blur", cancel); };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => {
      if (!viewport.clientWidth) return;
      const width = Math.min(CANVAS_NODE_WIDTH, Math.max(280, viewport.clientWidth - 48));
      setNodeWidth(width);
      const initial = previousViewportWidth.current === 0;
      const delta = (viewport.clientWidth - previousViewportWidth.current) / 2;
      setPan((current) => initial
        ? { x: Math.round((viewport.clientWidth - width) / 2 - CANVAS_START_X), y: 0 }
        : { x: current.x + delta, y: current.y });
      previousViewportWidth.current = viewport.clientWidth;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Connectors follow the rendered card height when text wraps or is resized.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver((entries) => {
      setNodeHeights((current) => {
        const next = { ...current };
        let changed = false;
        for (const entry of entries) {
          const node = entry.target as HTMLElement;
          const id = node.dataset.flowNodeId;
          if (!node.offsetHeight || !viewport.clientWidth) continue;
          if (id && next[id] !== node.offsetHeight) {
            next[id] = node.offsetHeight;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    viewport.querySelectorAll<HTMLElement>("[data-flow-node-id]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [nodeKeys]);

  const layout = layoutFlowNodes(draft.steps.map((step, index) => step.id || `step-${index}`), nodeHeights, nodeWidth);
  const triggerPosition = layout.trigger;
  const stepPositions = layout.steps;
  const endPosition = layout.end;
  const nodes = [layout.trigger, ...layout.steps, layout.end];

  useEffect(() => {
    if (!preview) return;
    const viewport = viewportRef.current;
    const target = viewport?.querySelector<HTMLElement>(`[data-flow-action-id="${CSS.escape(selection)}"]`);
    if (!viewport || !target) return;
    const area = viewport.getBoundingClientRect(), card = target.getBoundingClientRect();
    setPan((current) => ({ x: current.x + area.left + area.width / 2 - card.left - card.width / 2, y: current.y + area.top + area.height / 2 - card.top - card.height / 2 }));
  }, [selection, preview]);

  function changeZoom(nextZoom: number) {
    const next = Math.min(1.5, Math.max(MIN_FLOW_ZOOM, nextZoom));
    const viewport = viewportRef.current;
    if (!viewport) return setZoom(next);
    const center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    const world = { x: (center.x - pan.x) / zoom, y: (center.y - pan.y) / zoom };
    setPan({ x: center.x - world.x * next, y: center.y - world.y * next });
    setZoom(next);
  }

  function focusAction(id: string) {
    onNavigate(id);
    const viewport = viewportRef.current;
    const node = viewport?.querySelector<HTMLElement>(id === "trigger" ? '[data-flow-node-id="__trigger"]' : `[data-flow-action-id="${CSS.escape(id)}"]`);
    const card = node?.querySelector<HTMLElement>("[data-flow-card]") ?? node;
    if (!viewport || !card) return;
    const area = viewport.getBoundingClientRect(), bounds = card.getBoundingClientRect();
    const point = canvasPointFromClient({ x: bounds.left, y: bounds.top }, { x: area.left, y: area.top }, pan, zoom);
    const nextZoom = Math.min(1, Math.max(MIN_FLOW_ZOOM, (area.width - 64) / (bounds.width / zoom)));
    setZoom(nextZoom);
    setPan({ x: (area.width - bounds.width / zoom * nextZoom) / 2 - point.x * nextZoom, y: 96 - point.y * nextZoom });
  }

  function fitView() {
    const viewport = viewportRef.current;
    if (!viewport || !nodes.length) return;
    const bounds = nodes.map((node) => {
      const step = draft.steps.find((item) => item.id === node.id);
      const branchWidth = step?.type === "split" ? flowNodeWidth(step) : node.width;
      return { ...node, x: node.x - Math.max(0, branchWidth - node.width) / 2, width: Math.max(node.width, branchWidth) };
    });
    const fitted = fitFlowCanvas(bounds, { width: viewport.clientWidth, height: viewport.clientHeight });
    setZoom(fitted.zoom);
    setPan(fitted.pan);
  }

  function startNodeDrag(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    const control = (event.target as HTMLElement).closest("[data-no-drag],button,input,select,textarea,a");
    if (!canEdit || event.button !== 0 || !event.currentTarget.contains(event.target as Node) || (control && event.currentTarget.contains(control))) return;
    event.stopPropagation();
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, start: { x: event.clientX, y: event.clientY }, element: event.currentTarget, pointerId: event.pointerId, moved: false };
  }

  function moveNode(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    const position = { x: event.clientX, y: event.clientY };
    setDropTarget(targetAtPoint(position));
    setDragPreview({ id: drag.id, position });
  }

  function endNodeDrag(event: ReactPointerEvent<HTMLElement>, cancelled = false) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    suppressClickRef.current = !cancelled && drag.moved;
    // Only consume the click generated by this pointer release, never the user's next click.
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    setDragPreview(null);
    setDropTarget(null);
    const target = targetAtPoint({ x: event.clientX, y: event.clientY });
    if (!cancelled && drag.moved && target) {
      setInsertAt(null);
      onDropFlowAction({ actionId: drag.id }, target);
    }
  }

  function startPan(event: ReactPointerEvent<HTMLElement>) {
    // React portal events bubble here although the menu is outside the canvas DOM.
    if (event.button !== 0 || !event.currentTarget.contains(event.target as Node) || (event.target as HTMLElement).closest("[data-canvas-node], [data-canvas-controls], [data-no-drag]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { start: { x: event.clientX, y: event.clientY }, origin: pan };
    setPanning(true);
  }

  function movePan(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current) return moveNode(event);
    const active = panRef.current;
    if (!active) return;
    setPan({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y });
  }

  function endPan(event: ReactPointerEvent<HTMLElement>, cancelled = false) {
    if (dragRef.current) return endNodeDrag(event, cancelled);
    if (!panRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panRef.current = null;
    setPanning(false);
  }

  function moveCanvasWithWheel(event: ReactWheelEvent<HTMLElement>) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      changeZoom(zoom - event.deltaY * 0.0015);
      return;
    }
    setPan((current) => ({
      x: current.x - (event.shiftKey ? event.deltaY : event.deltaX),
      y: current.y - (event.shiftKey ? 0 : event.deltaY),
    }));
  }

  function targetAtPoint(client: CanvasPoint): FlowDropTarget | null {
    const viewport = viewportRef.current;
    if (!canEdit || !viewport) return null;
    const rect = viewport.getBoundingClientRect();
    if (client.x < rect.left || client.x > rect.right || client.y < rect.top || client.y > rect.bottom) return null;
    // DragOverlay's wrapper can receive pointer hits even when its card cannot.
    const hit = document.elementsFromPoint(client.x, client.y).find((element) => viewport.contains(element));
    if (!hit || !viewport.contains(hit) || hit.closest("[data-canvas-controls]")) return null;
    const branch = hit.closest<HTMLElement>("[data-flow-branch-id]");
    if (branch) {
      const slot = hit.closest<HTMLElement>("[data-flow-branch-insert-index]");
      if (slot && slot.closest("[data-flow-branch-id]") === branch) return { branchId: branch.dataset.flowBranchId!, index: Number(slot.dataset.flowBranchInsertIndex) };
      const actions = [...branch.querySelectorAll<HTMLElement>("[data-flow-action-id]")].filter((node) => node.closest("[data-flow-branch-id]") === branch);
      const index = actions.findIndex((node) => { const bounds = node.getBoundingClientRect(); return client.y < bounds.top + bounds.height / 2; });
      return { branchId: branch.dataset.flowBranchId!, index: index < 0 ? actions.length : index };
    }
    if (hit.closest("[data-flow-split-branches], [data-flow-split-header]")) return null;
    const point = canvasPointFromClient(client, { x: rect.left, y: rect.top }, pan, zoom);
    return { branchId: null, index: flowInsertIndex(point.y, layout.steps) };
  }

  function paletteTarget(event: DragMoveEvent) {
    if (!(event.activatorEvent instanceof PointerEvent)) return null;
    return targetAtPoint({ x: event.activatorEvent.clientX + event.delta.x, y: event.activatorEvent.clientY + event.delta.y });
  }

  useDndMonitor({
    onDragMove: (event) => setDropTarget(paletteTarget(event)),
    onDragOver: (event) => setDropTarget(paletteTarget(event)),
    onDragCancel: () => setDropTarget(null),
    onDragEnd: (event) => {
      setDropTarget(null);
      const type = event.active.data.current?.flowStepType as FlowStepType;
      const target = paletteTarget(event);
      if (target && stepTypes.includes(type)) onDropFlowAction({ type }, target);
    },
  });

  const connectorNodes = nodes.slice(0, -1).map((node, index) => ({ from: node, to: nodes[index + 1]!, insertAt: index }));
  const indicatorIndex = paletteDropIndex;
  const indicator = indicatorIndex === null ? null : connectorNodes[indicatorIndex];

  // Clipping prevents focus changes from scrolling the canvas behind its pan transform.
  return <main ref={setViewportRef} aria-label="Workflow canvas. Drag the background or scroll to pan. Drag actions to reorder the workflow." onWheel={moveCanvasWithWheel} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={(event) => endPan(event, true)} onClickCapture={(event) => { if (suppressClickRef.current) { event.stopPropagation(); suppressClickRef.current = false; } }} className={`relative min-h-0 touch-none overflow-clip bg-muted/10 select-none ${panning ? "cursor-grabbing" : "cursor-grab"}`} style={{ backgroundImage: "radial-gradient(circle, color-mix(in oklch, var(--border), transparent 20%) 1px, transparent 1px), radial-gradient(circle at 50% 0%, rgb(62 207 142 / 0.07), transparent 42%)", backgroundPosition: `${pan.x}px ${pan.y}px, center`, backgroundSize: `${24 * zoom}px ${24 * zoom}px, auto` }}>
    <div data-canvas-controls className="absolute left-4 top-4 z-40"><FlowOutline steps={draft.steps} selection={selection} onFocus={focusAction} /></div>
    <div className="absolute left-0 top-0 h-[2400px] w-[2400px] origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {connectorNodes.map(({ from, to }, index) => <path key={index} d={`M ${from.x + from.width / 2} ${from.y + from.height} L ${to.x + to.width / 2} ${to.y}`} fill="none" stroke="currentColor" strokeWidth="2" className="text-border" vectorEffect="non-scaling-stroke" />)}
      </svg>
      {connectorNodes.map(({ from, to, insertAt: position }) => <div key={`add-${position}`} data-canvas-node data-flow-insert-at={position} className={`absolute ${insertAt === position ? "z-40" : "z-20"}`} style={{ left: from.x + from.width / 2 - 14, top: (from.y + from.height + to.y) / 2 - 14 }}>
        <FlowActionPicker items={actionChoices} context="Main sequence" label={`Add action at position ${position + 1}`} disabled={!canEdit} open={insertAt === position} onOpenChange={(open) => setInsertAt(open ? position : null)} onAdd={(type) => onAddStep(type, position)} />
      </div>)}
      <div data-canvas-node data-flow-node-id={triggerId} className="absolute" style={{ left: triggerPosition.x, top: triggerPosition.y, width: nodeWidth }}><button type="button" onClick={() => setSelection("trigger")} className={`w-full rounded-xl border bg-background p-3 text-left shadow-sm transition-shadow hover:shadow-md ${selection === "trigger" ? "border-primary ring-2 ring-primary/15" : ""}`}><div className="flex items-start gap-2.5"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background"><Workflow className="size-5" strokeWidth={2} /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-body font-semibold leading-5 text-foreground">Trigger</p><Badge variant="outline" className="h-6 px-2.5 text-xs font-medium">Enrollment</Badge></div><p className="mt-0.5 text-sm leading-5 text-muted-foreground">{formatTrigger(draft.triggerType, draft.triggerConfig)}</p>{draft.triggerConfig.flowScope ? <p translate="no" data-no-translate className="mt-2 break-all text-sm font-medium text-primary">{String(draft.triggerConfig.scopeLabel)}</p> : null}<div className="mt-2 flex flex-wrap gap-1.5"><Badge variant="secondary" className="min-h-6 gap-1.5 px-2 text-xs font-medium [&_svg]:size-3.5"><ListFilter />{Array.isArray(draft.triggerConfig.contactIds) ? `${draft.triggerConfig.contactIds.length} selected customer${draft.triggerConfig.contactIds.length === 1 ? "" : "s"}` : isSegmentAudienceFlow(draft.triggerType, draft.triggerConfig) ? "Segment audience" : "Profile filters"}</Badge><Badge variant="outline" className="h-auto min-h-6 max-w-full whitespace-normal px-2 text-left text-xs font-medium">One active run per conversation</Badge></div></div></div></button></div>
      {draft.steps.map((step, index) => {
        const id = step.id || `step-${index}`;
        const dragging = dragPreview?.id === id;
        const position = stepPositions[index]!;
        return <div key={id} data-canvas-node data-flow-node-id={id} data-flow-action-id={id} className={`absolute ${dragging ? "opacity-40" : ""}`} style={{ left: position.x, top: position.y, width: nodeWidth }}>
          <FlowNode step={step} index={index} selected={selection === step.id} onSelect={() => setSelection(step.id!)} selection={selection} onSelectAction={setSelection} onSplitChange={(config) => onUpdateStep(index, config)} preview={preview} onPointerDown={(event) => startNodeDrag(event, id)} dropTarget={dropTarget} onActionPointerDown={startNodeDrag} onInsertAction={(type, target) => onDropFlowAction({ type }, target)} onMove={(offset) => { setInsertAt(null); onMoveStep(index, offset); }} onRemove={() => { setInsertAt(null); onRemoveStep(index); }} disabled={!canEdit} last={index === draft.steps.length - 1} />
        </div>;
      })}
      <div data-canvas-node data-flow-node-id={endId} className="absolute" style={{ left: endPosition.x, top: endPosition.y, width: endPosition.width }}><div className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm"><CheckCircle2 className="mr-1 inline size-4" />End of workflow</div></div>
      {indicator ? <div data-flow-drop-indicator className="pointer-events-none absolute z-40 flex items-center gap-2" style={{ left: CANVAS_START_X - 12, top: (indicator.from.y + indicator.from.height + indicator.to.y) / 2 - 12, width: nodeWidth + 24 }}><span className="h-0.5 flex-1 bg-primary" /><span className="rounded-full border border-primary bg-background px-3 py-1 text-xs font-semibold text-primary shadow-sm">{dragPreview ? `Move to step ${(paletteDropIndex ?? 0) + 1}` : `Insert as step ${(paletteDropIndex ?? 0) + 1}`}</span><span className="h-0.5 flex-1 bg-primary" /></div> : null}
    </div>
    {dragPreview ? <div className="pointer-events-none fixed z-[80] rounded-xl border border-primary bg-background px-4 py-3 text-sm font-semibold shadow-xl" style={{ left: dragPreview.position.x + 14, top: dragPreview.position.y + 14 }}>{stepLabels[flowActionLocations(draft.steps).find(({ action }) => action.id === dragPreview.id)!.action.type]}</div> : null}
    <div data-canvas-controls className="absolute bottom-3 right-3 z-50 flex items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur md:bottom-5 md:right-5"><button type="button" onClick={() => changeZoom(zoom - 0.1)} aria-label="Zoom out" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Minus className="size-4" /></button><span translate="no" data-no-translate className="w-11 text-center text-xs font-semibold tabular-nums text-muted-foreground">{zoom < 0.01 ? "<1" : Math.round(zoom * 100)}%</span><button type="button" onClick={() => changeZoom(zoom + 0.1)} aria-label="Zoom in" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-4" /></button><span className="mx-1 h-5 w-px bg-border" /><button type="button" onClick={fitView} aria-label="Fit workflow to canvas" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Maximize2 className="size-4" /></button></div>
    <div className="pointer-events-none absolute bottom-4 left-4 hidden rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur lg:block">Drag actions to reorder · Scroll to pan · Ctrl-scroll to zoom</div>
  </main>;
}

export function FlowBuilder({ initialFlows, mailboxOptions, memberOptions, initialFlowId, canEdit: canCreate, viewerId, isAdmin = false, filterOptions, initialDraft, scopedContext }: { initialFlows: AutomationFlow[]; mailboxOptions: FlowMailboxOption[]; memberOptions: Option[]; initialFlowId?: string; canEdit: boolean; viewerId: string; isAdmin?: boolean; filterOptions: FilterOptions; initialDraft?: FlowInput; scopedContext?: { config: JsonConfig; refreshUrl: string; returnHref: string } }) {
  const { t } = useLanguage();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [flows, setFlows] = useState(initialFlows);
  const flowsRef = useRef(flows);
  useEffect(() => { flowsRef.current = flows; }, [flows]);
  const [deletingFlow, setDeletingFlow] = useState<AutomationFlow | null>(null);
  const actionBusy = useRef(false);
  const initial = initialFlowId === "default" ? initialFlows.find((flow) => flow.name === "3-step follow-up" && flow.createdBy === viewerId) : initialFlows.find((flow) => flow.id === initialFlowId);
  const [draft, setDraft] = useState<DraftFlow | null>(initial ? toDraft(initial) : initialDraft ? { ...initialDraft, id: null } : null);
  const [view, setView] = useState<"list" | "builder">(initial || initialDraft ? "builder" : "list");
  const [selection, updateSelection] = useState<Selection>("trigger");
  const [inspectorTab, setInspectorTab] = useState("configure");
  const [mobileBuilderPanel, setMobileBuilderPanel] = useState<"canvas" | "settings">("canvas");
  const setSelection = (value: Selection) => { updateSelection(value); setInspectorTab("configure"); };
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [emailTestOpen, setEmailTestOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<FlowPreviewResult | null>(null);
  const [emailTestPath, setEmailTestPath] = useState<number[] | undefined>(undefined);
  const [scenarioLabOpen, setScenarioLabOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [auditOpen, setAuditDialogOpen] = useState(false);
  const canManageFlow = (flow: AutomationFlow) => canCreate && (isAdmin || flow.createdBy === viewerId);
  const canEdit = canCreate && (!draft?.id || flows.some((flow) => flow.id === draft.id && canManageFlow(flow)));

  useEffect(() => {
    const controller = new AbortController();
    function refreshAfterAgentAction(event: Event) {
      const detail = (event as CustomEvent<{ flowId?: string; flowEditorBefore?: FlowInput }>).detail;
      if (!detail?.flowId) return;
      void fetch(scopedContext?.refreshUrl || "/api/flows", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || "Unable to refresh workflows.");
          if (!controller.signal.aborted) {
            const previous = flowsRef.current;
            setDraft((current) => {
              const saved = previous.find((flow) => flow.id === current?.id);
              const updated = (result.flows as AutomationFlow[]).find((flow) => flow.id === (current?.id ?? detail.flowId));
              const definition = current ? flowInputSchema.safeParse(current) : null;
              const matchesRequest = detail.flowEditorBefore && definition?.success && JSON.stringify(definition.data) === JSON.stringify(detail.flowEditorBefore);
              const unchanged = saved && JSON.stringify(current) === JSON.stringify(toDraft(saved));
              return current && updated && (matchesRequest || unchanged) ? toDraft(updated) : current;
            });
            setFlows(result.flows);
          }
        })
        .catch(() => { if (!controller.signal.aborted) toast.error("Refresh Workflow to see the agent's latest changes."); });
    }
    window.addEventListener("filazoo:agent-action", refreshAfterAgentAction);
    return () => { controller.abort(); window.removeEventListener("filazoo:agent-action", refreshAfterAgentAction); };
  }, [scopedContext?.refreshUrl]);

  const senderOwnerId = flows.find((flow) => flow.id === draft?.id)?.createdBy || viewerId;
  const mailboxes = useMemo(() => flowSenderOptions(mailboxOptions, senderOwnerId), [mailboxOptions, senderOwnerId]);
  const palette = useMemo(() => stepTypes.filter((type) => type !== "if_condition" && `${stepLabels[type]} ${stepMeta[type].description}`.toLowerCase().includes(paletteQuery.toLowerCase())), [paletteQuery]);
  const selectedLocation = draft ? flowActionLocations(draft.steps).find((item) => item.action.id === selection) : undefined;
  const selectedIndex = selectedLocation?.path[0] ?? -1;
  const selectedMessagePath = selectedLocation?.path ?? [selectedIndex];
  const auditFindings = draft ? auditFlowDefinition(draft) : [];
  const auditCanLaunch = auditFindings.every((finding) => finding.severity !== "error");

  function openFlow(flow: AutomationFlow) { setDraft(toDraft(flow)); setSelection("trigger"); setView("builder"); setErrors({}); setNotice(""); }
  function updateStep(index: number, config: JsonConfig) { if (!draft) return; setDraft({ ...draft, steps: draft.steps.map((step, i) => i === index ? { ...step, config } : step) }); }
  function updateSelectedStep(config: JsonConfig) {
    if (!draft || !selectedLocation) return;
    setDraft({ ...draft, steps: editFlowSiblings(draft.steps, selectedLocation.path, (steps, index) => steps.map((step, i) => i === index ? { ...step, config } : step)) });
  }
  function duplicateSelectedStep() {
    if (!draft || !selectedLocation) return;
    const copy = cloneFlowStep(selectedLocation.action);
    setDraft({ ...draft, steps: editFlowSiblings(draft.steps, selectedLocation.path, (steps, index) => { steps.splice(index + 1, 0, copy); return steps; }) });
    setSelection(copy.id!);
  }
  function removeSelectedStep() {
    if (!draft || !selectedLocation) return;
    setDraft({ ...draft, steps: editFlowSiblings(draft.steps, selectedLocation.path, (steps, index) => steps.filter((_, i) => i !== index)) });
    setSelection("trigger");
  }
  function moveStep(index: number, offset: number) { if (!draft) return; const target = index + offset; if (target < 0 || target >= draft.steps.length) return; setDraft({ ...draft, steps: reorderFlowSteps(draft.steps, index, target) }); }
  function dropAction(input: FlowDragInput, target: FlowDropTarget) {
    if (!draft || !canEdit) return;
    const result = dropFlowAction(draft.steps, target, "type" in input ? { action: blankStep(input.type) } : input);
    if (result.error) { toast.error(t(result.error)); return null; }
    setDraft({ ...draft, steps: result.steps });
    if (result.action?.id) setSelection(result.action.id);
    setInsertAt(null);
    return result.action ?? null;
  }
  function addStep(type: FlowStepType, position = draft?.steps.length ?? 0) { return dropAction({ type }, { branchId: null, index: position }) ?? null; }
  function removeStep(index: number) { if (!draft) return; const steps = draft.steps.filter((_, i) => i !== index); setDraft({ ...draft, steps }); setSelection(steps[Math.min(index, steps.length - 1)]?.id || "trigger"); }

  async function setAuditOpen(open: boolean) {
    setAuditDialogOpen(open);
    if (!open || !draft || !canEdit) return;
    setNotice("Running a safe backend test…");
    try {
      const response = await fetch("/api/flows/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flow: draft }) });
      const result = await response.json().catch(() => ({ ok: false, error: "The test returned an invalid response." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Workflow test failed.");
      setNotice(`Simulation passed · ${result.trace.length} steps checked. ${result.warnings?.join(" ") || "No messages were sent."}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Workflow test failed.");
    }
  }

  async function persist(status: FlowStatus = draft?.status ?? "draft") {
    if (!draft || !canEdit) return;
    const payload = { name: draft.name, triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, status, steps: draft.steps };
    const parsed = flowInputSchema.safeParse(payload);
    if (!parsed.success) { const next: Record<string, string> = {}; parsed.error.issues.forEach((issue) => { const key = issue.path[0] === "steps" ? `step-${String(issue.path[1])}` : String(issue.path[0] || "form"); next[key] ||= issue.message; }); setErrors(next); setNotice(parsed.error.issues[0]?.message || "Complete the highlighted settings before saving."); return; }
    setSaving(true); setErrors({}); setNotice("");
    try { const response = await fetch(draft.id ? `/api/flows/${draft.id}` : "/api/flows", { method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }); const result = await response.json().catch(() => ({ ok: false, error: "The server returned an invalid response." })); if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save workflow."); const flow = result.flow as AutomationFlow; setFlows((current) => current.some((item) => item.id === flow.id) ? current.map((item) => item.id === flow.id ? flow : item) : [flow, ...current]); setDraft(toDraft(flow)); setSelection(selectedIndex >= 0 ? flow.steps[selectedIndex]?.id || "trigger" : "trigger"); setNotice(status === "live" ? "Workflow is live." : status === "paused" ? "Workflow paused." : "All changes saved."); toast.success(status === "live" ? "Automation turned on" : status === "paused" ? "Automation paused" : "Workflow saved"); } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save workflow."); } finally { setSaving(false); }
  }

  async function removeFlow(flow: AutomationFlow) {
    if (!canManageFlow(flow)) return;
    const response = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({ ok: false }));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to delete workflow.");
    setFlows((current) => current.filter((item) => item.id !== flow.id));
    if (draft?.id === flow.id) { setDraft(null); setView("list"); }
    toast.success("Workflow deleted");
  }

  async function duplicateFlow(flow: AutomationFlow) {
    if (!canCreate || actionBusy.current) return;
    actionBusy.current = true;
    try {
      const payload = { ...toDraft(flow), id: undefined, name: `${flow.name} copy`, status: "draft" as const, steps: flow.steps.map(cloneFlowStep) };
      const response = await fetch("/api/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to duplicate workflow.");
      setFlows((current) => [result.flow, ...current]);
      openFlow(result.flow);
      toast.success("Workflow duplicated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to duplicate workflow. Please retry.");
    } finally {
      actionBusy.current = false;
    }
  }

  async function changeStatus(flow: AutomationFlow, status: FlowStatus) {
    if (!canManageFlow(flow) || actionBusy.current) return;
    actionBusy.current = true;
    try {
      const payload = { ...toDraft(flow), status, steps: flow.steps.map((step) => ({ id: step.id, type: step.type, config: step.config })) };
      const response = await fetch(`/api/flows/${flow.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update workflow.");
      setFlows((current) => current.map((item) => item.id === flow.id ? result.flow : item));
      if (draft?.id === flow.id) setDraft(toDraft(result.flow));
      toast.success(status === "live" ? "Automation turned on" : "Automation paused");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update workflow. Please retry.");
    } finally {
      actionBusy.current = false;
    }
  }

  async function runBulkAction(ids: string[], action: FlowBulkAction): Promise<FlowBulkResult[]> {
    if (!canCreate || actionBusy.current) throw new Error("Another workflow action is in progress.");
    actionBusy.current = true;
    try {
      const response = await fetch("/api/flows/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action }) });
      const result = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update workflows.");
      const results = result.results as FlowBulkResult[];
      const changes = new Map(results.map((item) => [item.id, item]));
      setFlows((current) => current.flatMap((flow) => {
        const change = changes.get(flow.id);
        if (!change?.ok) return [flow];
        return action === "delete" ? [] : [change.flow ?? flow];
      }));
      setDraft((current) => {
        const change = current?.id ? changes.get(current.id) : undefined;
        if (!change?.ok) return current;
        return action === "delete" ? null : change.flow ? toDraft(change.flow) : current;
      });
      return results;
    } finally {
      actionBusy.current = false;
    }
  }

  if (view === "list" || !draft) return <><FlowListView flows={flows} canEdit={canCreate} viewerId={viewerId} isAdmin={isAdmin} memberOptions={memberOptions} scopedContext={scopedContext} onBulkAction={runBulkAction} onCreate={() => { if (!scopedContext) { setStarterOpen(true); return; } setDraft(initialDraft ? { ...initialDraft, id: null, triggerConfig: { ...initialDraft.triggerConfig }, steps: initialDraft.steps.map((step) => ({ ...step, id: crypto.randomUUID(), config: { ...step.config } })) } : newDraft()); setSelection("trigger"); setView("builder"); }} onOpen={openFlow} onDuplicate={duplicateFlow} onChangeStatus={changeStatus} onRemove={async (flow) => { setDeletingFlow(flow); }} />{starterOpen ? <Suspense fallback={null}><LazyStarterDialog onOpenChange={setStarterOpen} onChoose={(flow) => { setDraft({ ...flow, id: null }); setSelection("trigger"); setView("builder"); setErrors({}); setNotice(""); setStarterOpen(false); }} /></Suspense> : null}<ConfirmActionDialog open={Boolean(deletingFlow)} onOpenChange={(open) => { if (!open) setDeletingFlow(null); }} title="Delete workflow?" description={`Delete “${deletingFlow?.name ?? ""}” and its run history? This cannot be undone.`} onConfirm={async () => { if (deletingFlow) await removeFlow(deletingFlow); }} /></>;

  const selectedStep = selectedLocation?.action;
  const savedFlow = flows.find((flow) => flow.id === draft.id);
  const hasUnsavedChanges = !savedFlow || JSON.stringify(draft) !== JSON.stringify(toDraft(savedFlow));
  return <div data-ai-flow-id={draft.id} data-ai-flow-draft={JSON.stringify({ name: draft.name, triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, status: draft.status, steps: draft.steps })} data-ai-flow-unsaved={hasUnsavedChanges} data-ai-flow-step-id={selection} className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 [&>header]:static! [&>header]:shrink-0">
    <header className="sticky top-12 z-20 flex min-h-14 flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur"><button type="button" onClick={() => { if (scopedContext) window.location.assign(scopedContext.returnHref); else setView("list"); }} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />{scopedContext ? "Email" : "Workflow"}</button><ChevronRight className="size-3.5 text-muted-foreground" /><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-label="Workflow name" className="h-8 min-w-0 flex-1 sm:w-64 sm:flex-none border-transparent px-2 text-sm font-semibold hover:border-input focus:border-input" disabled={!canEdit || previewOpen} /><Badge variant={statusVariant(draft.status)} className="capitalize">{draft.status}</Badge><span className="hidden text-xs text-muted-foreground xl:inline">{flowActionLocations(draft.steps).length} actions · {draft.activeRuns || 0} active</span><div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto max-sm:[&_svg]:hidden">{previewOpen ? <Button variant="outline" size="sm" onClick={() => { setPreviewOpen(false); setPreviewResult(null); }}>Exit preview</Button> : <><DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" />}><ListFilter />Test workflow</DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuItem onClick={() => setAuditOpen(true)} disabled={!canEdit}><AiIcon />Audit workflow</DropdownMenuItem><DropdownMenuItem onClick={() => setScenarioLabOpen(true)}><ListFilter />Test scenarios</DropdownMenuItem><DropdownMenuItem onClick={() => { setEmailTestPath(undefined); setEmailTestOpen(true); }} disabled={!canCreate}><Mail />Test with emails</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button variant="outline" size="sm" onClick={() => { setPreviewOpen(true); setPreviewResult(null); setInsertAt(null); setMobileBuilderPanel("settings"); }}><Eye />Preview</Button><Button variant="outline" size="sm" onClick={() => void persist(draft.status)} disabled={!canEdit || saving}><Save />{saving ? "Saving…" : "Save"}</Button>{draft.status === "live" ? <Button size="sm" variant="secondary" onClick={() => void persist("paused")} disabled={!canEdit || saving}><Pause />Pause</Button> : <Button size="sm" onClick={() => void persist("live")} disabled={!canEdit || saving}><Play />Turn on</Button>}</>}</div></header>
    {scopedContext ? <div className="flex items-center gap-3 border-b bg-background px-4 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{String(scopedContext.config.scopeLabel)}</span><Button size="sm" variant="ghost" onClick={() => setView("list")}>Manage email workflows</Button></div> : null}
    {!canEdit ? <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{canCreate ? "Shared workflow is read-only. Its creator or an administrator can change it." : "Viewer access is read-only."}</div> : null}
    <div className="flex shrink-0 gap-2 border-b bg-background px-4 py-2 md:hidden" role="group" aria-label="Workflow workspace view">
      <Button variant={mobileBuilderPanel === "canvas" ? "secondary" : "ghost"} className="flex-1" aria-pressed={mobileBuilderPanel === "canvas"} onClick={() => setMobileBuilderPanel("canvas")}><Workflow />Canvas</Button>
      <Button variant={mobileBuilderPanel === "settings" ? "secondary" : "ghost"} className="flex-1" aria-pressed={mobileBuilderPanel === "settings"} onClick={() => setMobileBuilderPanel("settings")}><Settings2 />Configure / Insights</Button>
    </div>
    <DndContext id="flow-action-palette" sensors={sensors} collisionDetection={pointerWithin} autoScroll={false}>
    <div data-mobile-panel={mobileBuilderPanel} className="crm-flow-workspace grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,42%)] overflow-hidden lg:flex lg:flex-nowrap [&>main]:min-w-0 [&>main]:flex-1">
      {!previewOpen ? <FlowActionPalette
        canEdit={canEdit}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        actions={palette}
        onAdd={(type) => addStep(type, insertAt ?? draft.steps.length)}
        onAudit={() => setAuditOpen(true)}
      /> : null}
      <FlowCanvas key={draft.id || "new-flow"} draft={draft} selection={selection} insertAt={insertAt} canEdit={canEdit && !previewOpen} preview={previewOpen ? previewResult : null} setSelection={(value) => { setSelection(value); if (!previewOpen) setMobileBuilderPanel("settings"); }} setInsertAt={setInsertAt} onAddStep={addStep} onDropFlowAction={dropAction} onNavigate={setSelection} onMoveStep={moveStep} onRemoveStep={removeStep} onUpdateStep={updateStep} />
      {previewOpen ? <FlowJourneyPreview flow={draft} flowId={draft.id} result={previewResult} onResult={setPreviewResult} onFocus={(id) => { setSelection(id); setMobileBuilderPanel("canvas"); }} onTestMessage={(path) => { setEmailTestPath(path); setEmailTestOpen(true); }} /> : <aside className="scroll-surface min-h-0 overflow-y-auto border-t bg-background lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0 xl:w-[360px]"><Tabs value={inspectorTab} onValueChange={setInspectorTab} className="min-h-full gap-0"><TabsList variant="line" className="sticky top-0 z-10 h-12 w-full justify-start border-b bg-background px-4"><TabsTrigger value="configure"><Settings2 />Configure</TabsTrigger><TabsTrigger value="insights"><History />Insights</TabsTrigger></TabsList><TabsContent value="configure" className="p-4 sm:p-5">{selection === "trigger" ? <><TriggerInspector draft={draft} setDraft={setDraft} filterOptions={filterOptions} disabled={!canEdit} /><ReentrySettings draft={draft} setDraft={setDraft} disabled={!canEdit} />{errors.triggerConfig ? <p className="mt-4 text-xs text-destructive">{errors.triggerConfig}</p> : null}</> : selectedStep ? <>{["send_email", "ai_auto_reply"].includes(selectedStep.type) ? <Button variant="outline" size="sm" className="mb-5 w-full" onClick={() => { setEmailTestPath(selectedMessagePath); setEmailTestOpen(true); }}><Eye />Preview & test message</Button> : null}<div aria-label="Action location" className="mb-4 rounded-lg border bg-muted/25 px-3 py-2 text-[11px] leading-5 text-muted-foreground"><span className="block font-medium text-foreground">Action location</span><span translate="no" className="break-words">{selectedLocation && flowActionTrail(draft.steps, selectedLocation.path).length ? flowActionTrail(draft.steps, selectedLocation.path).join(" / ") : t("Main sequence")}</span></div><StepInspector type={selectedStep.type} config={selectedStep.config} onChange={updateSelectedStep} mailboxes={mailboxes} members={memberOptions} disabled={!canEdit} />{errors[`step-${selectedIndex}`] ? <p className="mt-4 text-xs text-destructive">{errors[`step-${selectedIndex}`]}</p> : null}<div className="mt-6 flex gap-2 border-t pt-4"><Button variant="outline" size="sm" onClick={duplicateSelectedStep} disabled={!canEdit}><Copy />Duplicate</Button><Button variant="destructive" size="sm" onClick={removeSelectedStep} disabled={!canEdit}><Trash2 />Remove</Button></div></> : null}</TabsContent><TabsContent value="insights" className="p-4 sm:p-5"><FlowInsights key={draft.id} flowId={draft.id} /></TabsContent></Tabs>{notice ? <div className="sticky bottom-0 border-t bg-background px-5 py-3 text-xs text-muted-foreground" role="status">{notice}</div> : null}</aside>}
    </div>
    <FlowPaletteOverlay />
    </DndContext>
    {scenarioLabOpen ? <Suspense fallback={null}><LazyScenarioLab flow={draft} onOpenChange={setScenarioLabOpen} /></Suspense> : null}
    {emailTestOpen ? <FlowEmailTestDialog key={emailTestPath?.join("-") || "journey"} flow={draft} messageStepPath={emailTestPath} sample={previewOpen && previewResult ? { facts: previewResult.facts, customerName: previewResult.customer?.name, email: previewResult.customer?.email } : undefined} open={emailTestOpen} onOpenChange={setEmailTestOpen} /> : null}

    <Dialog open={auditOpen} onOpenChange={setAuditOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><AiIcon className="size-4 text-violet-600" />Workflow audit</DialogTitle><DialogDescription>Checks configuration, B2B safety, message pressure, and customer experience before launch.</DialogDescription></DialogHeader><div className="max-h-[55vh] space-y-2 overflow-auto">{auditFindings.map((finding) => <AuditRow key={finding.id} severity={finding.severity} label={`${finding.label}${finding.step ? ` · step ${finding.step}` : ""}`} />)}</div>{notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}<DialogFooter showCloseButton><Button onClick={() => { setAuditOpen(false); if (!auditCanLaunch) setNotice("Resolve blocking audit findings before turning on this workflow."); }}><Check />{auditCanLaunch ? "Audit passed" : "Review findings"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function FlowListView({ flows, canEdit, viewerId, isAdmin, memberOptions, onCreate, onOpen, onDuplicate, onChangeStatus, onRemove, onBulkAction, scopedContext }: {
  scopedContext?: { config: JsonConfig; returnHref: string };
  flows: AutomationFlow[];
  canEdit: boolean;
  viewerId: string;
  isAdmin: boolean;
  memberOptions: Option[];
  onCreate: () => void;
  onOpen: (flow: AutomationFlow) => void;
  onDuplicate: (flow: AutomationFlow) => Promise<unknown>;
  onChangeStatus: (flow: AutomationFlow, status: FlowStatus) => Promise<unknown>;
  onRemove: (flow: AutomationFlow) => Promise<unknown>;
  onBulkAction: (ids: string[], action: FlowBulkAction) => Promise<FlowBulkResult[]>;
}) {
  const { language, t } = useLanguage();
  const memberLabels = new Map(memberOptions.map((member) => [member.id, member.label]));
  const liveFlows = flows.filter((flow) => flow.status === "live").length;
  const activeRuns = flows.reduce((total, flow) => total + (flow.activeRuns || 0), 0);
  const completedRuns = flows.reduce((total, flow) => total + (flow.completedRuns || 0), 0);
  const dateFormatter = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkBusyRef = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<Array<{ id: string; error: string }>>([]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(flows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleFlows = flows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const canManage = (flow: AutomationFlow) => canEdit && (isAdmin || flow.createdBy === viewerId);
  const selectedFlows = flows.filter((flow) => selectedIds.includes(flow.id) && canManage(flow));
  const selectablePage = visibleFlows.filter(canManage);
  const allPageSelected = selectablePage.length > 0 && selectablePage.every((flow) => selectedIds.includes(flow.id));
  const somePageSelected = selectablePage.some((flow) => selectedIds.includes(flow.id));

  function selectFlows(ids: string[]) {
    if (bulkBusyRef.current) return;
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length > 100) { toast.error(t("Select up to 100 workflows at a time.")); return; }
    setSelectedIds(uniqueIds);
  }

  async function applyBulk(action: FlowBulkAction) {
    if (bulkBusyRef.current || !selectedFlows.length) return;
    bulkBusyRef.current = true;
    setBulkBusy(true);
    setBulkErrors([]);
    try {
      const results = await onBulkAction(selectedFlows.map((flow) => flow.id), action);
      const succeeded = new Set(results.filter((result) => result.ok).map((result) => result.id));
      setSelectedIds((current) => current.filter((id) => !succeeded.has(id)));
      const errors = results.filter((result): result is Extract<FlowBulkResult, { ok: false }> => !result.ok);
      setBulkErrors(errors);
      if (errors.length) toast.error(t("Some workflows could not be updated. Review the errors below."));
      else toast.success(t(action === "delete" ? "Selected workflows deleted." : action === "live" ? "Selected workflows turned on." : "Selected workflows paused."));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update workflows.";
      setBulkErrors(selectedFlows.map((flow) => ({ id: flow.id, error: message })));
      toast.error(t(message));
    } finally {
      bulkBusyRef.current = false;
      setBulkBusy(false);
    }
  }

  return <section className="scroll-surface h-full min-h-0 overflow-y-auto bg-muted/20">
    <div className="w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-background text-primary shadow-sm"><Workflow className="size-5" /></span>
          <div><h1 className="text-xl font-semibold tracking-tight">{scopedContext ? "Email workflows" : "Workflow"}</h1><p className="mt-1 text-sm text-muted-foreground">Build, monitor, and improve automated customer journeys.</p></div>
        </div>
        <Button size="lg" onClick={onCreate} disabled={!canEdit || bulkBusy} className="shadow-sm"><Plus />Create workflow</Button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <FlowSummary icon={Workflow} label="Live workflows" value={liveFlows} detail={`${flows.length} total`} tone="bg-primary/10 text-primary" />
        <FlowSummary icon={Play} label="Active runs" value={activeRuns} detail="Currently in progress" tone="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
        <FlowSummary icon={CheckCircle2} label="Completed" value={completedRuns} detail="All-time journeys" tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
      </div>

      
        <div className="mt-6 mb-3 flex items-center justify-between">
          <div><h2 className="text-sm font-semibold">All workflows</h2><p className="mt-0.5 text-xs text-muted-foreground">{scopedContext ? "Workflows for this recipient, accessible from Email." : "All workspace workflows. Select a workflow to view its canvas and configuration."}</p></div>
          <Badge variant="secondary" className="tabular-nums">{flows.length}</Badge>
        </div>

      <Card className="crm-table-frame crm-table-page-wide gap-0 py-0">
        {selectedFlows.length ? <div role="group" aria-label="Bulk workflow actions" aria-busy={bulkBusy} className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-3">
          <span className="mr-auto text-sm font-semibold">{t(`${selectedFlows.length} selected`)}</span>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void applyBulk("live")}><Play />Turn on</Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void applyBulk("paused")}><Pause />Pause</Button>
          <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => setDeleteOpen(true)}><Trash2 />Delete</Button>
          <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelectedIds([])}>Clear selection</Button>
        </div> : null}
        {bulkErrors.length ? <div role="alert" className="max-h-48 overflow-auto border-b bg-destructive/5 px-4 py-3 text-sm"><p className="font-medium">Some workflows could not be updated. Review the errors below.</p><ul className="mt-2 list-disc space-y-1 pl-5">{bulkErrors.map((item) => <li key={item.id}><span translate="no" className="font-medium">{flows.find((flow) => flow.id === item.id)?.name || item.id}</span>: {item.error}</li>)}</ul></div> : null}
        {flows.length ? <>
          <div>
            <Table className="min-w-[1040px]">
              <TableHeader><TableRow className="bg-muted/30 hover:bg-muted/30"><TableHead className="w-12 pl-5"><Checkbox aria-label="Select all editable workflows on this page" checked={allPageSelected} indeterminate={!allPageSelected && somePageSelected} disabled={bulkBusy || !selectablePage.length} onCheckedChange={(checked) => selectFlows(checked ? [...new Set([...selectedFlows.map((flow) => flow.id), ...selectablePage.map((flow) => flow.id)])] : selectedIds.filter((id) => !selectablePage.some((flow) => flow.id === id)))} /></TableHead><TableHead>Workflow</TableHead><TableHead>Created by</TableHead><TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead className="text-center">Active</TableHead><TableHead className="text-center">Completed</TableHead><TableHead>Last updated</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
              <TableBody>{visibleFlows.map((flow) => <TableRow key={flow.id} data-state={selectedIds.includes(flow.id) ? "selected" : undefined} className="group cursor-pointer" onClick={() => { if (!bulkBusy) onOpen(flow); }}><TableCell className="pl-5" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`Select ${flow.name}`} checked={selectedIds.includes(flow.id)} disabled={bulkBusy || !canManage(flow)} onCheckedChange={(checked) => selectFlows(checked ? [...selectedFlows.map((item) => item.id), flow.id] : selectedIds.filter((id) => id !== flow.id))} /></TableCell><TableCell><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Workflow className="size-4" /></span><div><p className="font-semibold group-hover:text-primary">{flow.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{t(`${flowActionLocations(flow.steps).length} actions`)}</p></div></div></TableCell><TableCell className="text-sm">{memberLabels.get(flow.createdBy) || (flow.createdBy === viewerId ? "You" : "Workspace member")}</TableCell><TableCell><p className="max-w-64 truncate text-sm">{formatTrigger(flow.triggerType, flow.triggerConfig)}</p></TableCell><TableCell><FlowStatusBadge status={flow.status} /></TableCell><TableCell className="text-center font-medium tabular-nums">{flow.activeRuns || 0}</TableCell><TableCell className="text-center font-medium tabular-nums">{flow.completedRuns || 0}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateFormatter.format(new Date(flow.updatedAt))}</TableCell><TableCell><FlowActions flow={flow} canEdit={canManage(flow) && !bulkBusy} canDuplicate={canEdit && !bulkBusy} onOpen={onOpen} onDuplicate={onDuplicate} onChangeStatus={onChangeStatus} onRemove={onRemove} /></TableCell></TableRow>)}</TableBody>
            </Table>
          </div>



        </> : <div className="grid min-h-64 place-items-center px-6 py-12 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Workflow className="size-5" /></span><h3 className="mt-4 font-semibold">Create your first workflow</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Automate timely follow-ups, internal tasks, and customer journey decisions.</p><Button className="mt-5" onClick={onCreate} disabled={!canEdit}><Plus />Create workflow</Button></div></div>}
      </Card>
      <TablePagination className="mt-6" page={currentPage} pageCount={pageCount} total={flows.length} itemLabel="workflows" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} />
      <ConfirmActionDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete selected workflows?" description={t("Delete the selected workflows and their run history? This cannot be undone.")} onConfirm={() => applyBulk("delete")} />
    </div>
  </section>;
}

function FlowSummary({ icon: Icon, label, value, detail, tone }: { icon: typeof Workflow; label: string; value: number; detail: string; tone: string }) {
  return <Card className="gap-0 p-4 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><span className={`grid size-9 place-items-center rounded-xl ${tone}`}><Icon className="size-4" /></span></div></Card>;
}

function FlowStatusBadge({ status }: { status: FlowStatus }) {
  return <Badge variant={statusVariant(status)} className="gap-1.5 capitalize"><span className={`size-1.5 rounded-full ${status === "live" ? "bg-current" : status === "paused" ? "bg-amber-500" : "bg-muted-foreground"}`} />{status}</Badge>;
}

function FlowActions({ flow, canEdit, canDuplicate, onOpen, onDuplicate, onChangeStatus, onRemove }: {
  flow: AutomationFlow;
  canEdit: boolean;
  canDuplicate: boolean;
  onOpen: (flow: AutomationFlow) => void;
  onDuplicate: (flow: AutomationFlow) => Promise<unknown>;
  onChangeStatus: (flow: AutomationFlow, status: FlowStatus) => Promise<unknown>;
  onRemove: (flow: AutomationFlow) => Promise<unknown>;
}) {
  return <div onClick={(event) => event.stopPropagation()}><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${flow.name}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onOpen(flow)}>{canEdit ? "Edit" : "View"}</DropdownMenuItem><DropdownMenuItem onClick={() => void onDuplicate(flow)} disabled={!canDuplicate}><Copy />Duplicate</DropdownMenuItem><DropdownMenuItem onClick={() => void onChangeStatus(flow, flow.status === "live" ? "paused" : "live")} disabled={!canEdit}>{flow.status === "live" ? <Pause /> : <Play />}{flow.status === "live" ? "Pause" : "Turn on"}</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => void onRemove(flow)} disabled={!canEdit}><Trash2 />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>;
}

function AuditRow({ severity, label }: { severity: "error" | "warning" | "pass"; label: string }) { const ok = severity === "pass"; return <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${severity === "error" ? "border-destructive/30 bg-destructive/5" : ""}`}><span className={`grid size-6 place-items-center rounded-full ${ok ? "bg-emerald-50 text-emerald-600" : severity === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-amber-600"}`}>{ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}</span><span className="text-sm">{label}</span></div>; }
