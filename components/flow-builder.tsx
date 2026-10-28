"use client";

import { EmptyState } from "@/components/data-state";
import { useLanguage } from "@/components/language-provider";

import { AiIcon } from "@/components/ai-icon";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDndContext, useDndMonitor, useDraggable, useDroppable, useSensor, useSensors, type DragMoveEvent } from "@dnd-kit/core";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Bell, Check, CheckCircle2, ChevronRight,
  CircleStop, Clock3, Copy, Eye, GitBranch, History, ListFilter, Mail, MoreHorizontal,
  GripVertical, Maximize2, Minus, Pause, Play, Plus, Save, Search, Settings2, Tag, Trash2, UserRoundCheck, Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { FlowEmailTestDialog } from "@/components/flow-email-test-dialog";
import { FlowInsights } from "@/components/flow-insights";
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
  blankStep, companyStatuses, defaultFlowInput, emailCategories, flowInputSchema, flowLeadLists, formatTrigger, pipelineStages, stepLabels, stepTypes,
  triggerLabels, triggerTypes, type AutomationFlow, type FlowInput, type FlowStatus, type FlowStepType,
  type JsonConfig, type TriggerType, type FlowBulkAction, type FlowBulkResult,
} from "@/lib/flows";
import {
  CANVAS_NODE_WIDTH, CANVAS_START_X, canvasPointFromClient,
  flowInsertIndex, layoutFlowNodes, reorderFlowSteps, type CanvasPoint,
} from "@/lib/flow-canvas";

type Option = { id: string; label: string };
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
const conditionFields = [["customer_replied", "Customer replied"], ["category_is", "Category is"], ["opened_email", "Opened email"], ["clicked_link", "Clicked link"]] as const;
const conditionActions = [["stop_flow", "Stop flow"], ["continue", "Continue"], ["skip_next", "Skip next step"]] as const;

const stepMeta: Record<FlowStepType, { icon: typeof Mail | typeof AiIcon; tone: string; group: "Message" | "Data" | "Logic"; description: string }> = {
  ai_auto_reply: { icon: AiIcon, tone: "bg-violet-50 text-violet-600 dark:bg-violet-500/10", group: "Message", description: "Read email and send a personalized reply" },
  send_email: { icon: Mail, tone: "bg-blue-50 text-blue-600 dark:bg-blue-500/10", group: "Message", description: "Send a tracked template" },
  create_task: { icon: UserRoundCheck, tone: "bg-amber-50 text-amber-600 dark:bg-amber-500/10", group: "Data", description: "Assign follow-up work" },
  change_category: { icon: Tag, tone: "bg-orange-50 text-orange-600 dark:bg-orange-500/10", group: "Data", description: "Update conversation state" },
  internal_alert: { icon: Bell, tone: "bg-rose-50 text-rose-600 dark:bg-rose-500/10", group: "Data", description: "Notify a teammate" },
  wait: { icon: Clock3, tone: "bg-slate-100 text-slate-600 dark:bg-slate-500/10", group: "Logic", description: "Delay the next action" },
  if_condition: { icon: GitBranch, tone: "bg-violet-50 text-violet-600 dark:bg-violet-500/10", group: "Logic", description: "Branch on engagement" },
  stop: { icon: CircleStop, tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/10", group: "Logic", description: "End the journey" },
};

function toDraft(flow: AutomationFlow): DraftFlow {
  return { id: flow.id, name: flow.name, triggerType: flow.triggerType, triggerConfig: { ...flow.triggerConfig }, status: flow.status, activeRuns: flow.activeRuns, completedRuns: flow.completedRuns, updatedAt: flow.updatedAt, steps: flow.steps.map((step) => ({ id: step.id, type: step.type, config: { ...step.config } })) };
}

function newDraft(): DraftFlow {
  return { ...defaultFlowInput, id: null, name: "Untitled follow-up", status: "draft", activeRuns: 0, completedRuns: 0, triggerConfig: { ...defaultFlowInput.triggerConfig }, steps: defaultFlowInput.steps.map((step) => ({ ...step, id: crypto.randomUUID(), config: { ...step.config } })) };
}

function FlowSelect({ value, onChange, options, placeholder, disabled }: { value: string; onChange: (value: string) => void; options: readonly (readonly [string, string])[] | Option[]; placeholder?: string; disabled?: boolean }) {
  const normalized = options.map((option) => Array.isArray(option) ? { id: option[0], label: option[1] } : option) as Option[];
  const label = normalized.find((option) => option.id === value)?.label;
  return <Select value={value} onValueChange={(next) => next && onChange(next)} disabled={disabled}><SelectTrigger className="w-full"><SelectValue placeholder={placeholder}>{label}</SelectValue></SelectTrigger><SelectContent>{normalized.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>;
}

function AiReplyInspector({ config, onChange, mailboxes, disabled }: { config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; disabled: boolean }) {
  const set = (key: string, value: JsonConfig[string]) => onChange({ ...config, [key]: value });
  return <>
    <div className="rounded-lg bg-violet-50 p-3 text-xs leading-5 text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">Reads the latest customer email and conversation before sending. Leads without an email receive a welcome introduction.</div>
    <div className="space-y-2"><Label>Sender mailbox</Label><FlowSelect value={String(config.mailboxId || "default")} onChange={(value) => set("mailboxId", value)} options={mailboxes} disabled={disabled} /></div>
    <div className="space-y-2"><Label>Reply language</Label><FlowSelect value={String(config.language || "auto")} onChange={(value) => set("language", value)} options={[["auto", "Match customer email"], ["en", "English"], ["zh-CN", "Chinese"]]} disabled={disabled} /></div>
    <div className="space-y-2"><Label>Reply instructions</Label><Textarea value={String(config.instructions || "")} onChange={(event) => set("instructions", event.target.value)} maxLength={4000} placeholder="Answer the customer's questions and ask about their required quantities." disabled={disabled} /></div>
    <div className="space-y-2">
      <ToggleField checked={Boolean(config.useProducts)} onChange={(value) => onChange({ ...config, useProducts: value, ...(!value ? { usePrices: false } : {}) })} label="Read product information" detail="Use active CRM products, variants, availability and specifications." disabled={disabled} />
      <ToggleField checked={Boolean(config.usePrices)} onChange={(value) => set("usePrices", value)} label="Use saved product prices" detail="Quote verified CRM prices with currency, minimum quantities and quantity breaks." disabled={disabled || !config.useProducts} />
      <ToggleField checked={Boolean(config.attachCatalog)} onChange={(value) => set("attachCatalog", value)} label="Attach product catalog PDF" detail="Generate an attachment from current active CRM products and prices." disabled={disabled} />
      {config.attachCatalog ? <ToggleField checked={config.catalogFirstMessageOnly !== false} onChange={(value) => set("catalogFirstMessageOnly", value)} label="Attach catalog to first message only" detail="Only the first automated message to this lead includes the catalog, across flows and conversations." disabled={disabled} /> : null}
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
  if (type === "ai_auto_reply") return config.attachCatalog ? "Personalized reply + catalog PDF" : "Personalized reply from the conversation";
  if (type === "send_email") return templates.find((item) => item.id === config.templateId)?.label || "Choose an email template";
  if (type === "if_condition") return `${titleCase(config.field)} → ${titleCase(config.action)}`;
  if (type === "create_task") return String(config.title || "Create a CRM task");
  if (type === "change_category") return `Set category to ${config.category || "…"}`;
  if (type === "internal_alert") return String(config.message || "Notify a teammate");
  return "End this automation";
}

function ToggleField({ checked, onChange, label, detail, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; detail?: string; disabled?: boolean }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/40"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} disabled={disabled} className="mt-0.5" /><span><span className="block text-sm font-medium">{label}</span>{detail ? <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{detail}</span> : null}</span></label>;
}

function TriggerInspector({ draft, setDraft, filterOptions = { segments: [], countries: [] }, disabled }: { draft: DraftFlow; setDraft: (flow: DraftFlow) => void; filterOptions?: FilterOptions; disabled: boolean }) {
  const configs: Record<TriggerType, JsonConfig> = { new_lead: {}, email_received: {}, category_changed: { category: "Needs follow-up" }, no_reply: { amount: 2, unit: "days", businessDays: true }, lead_added_to_list: { listId: "Shopify B2B leads" }, company_segment_changed: { segment: filterOptions.segments[0] || "Shopify B2B lead" }, pipeline_stage_changed: { stage: "new" } };
  const updateConfig = (key: string, value: string | number | boolean | null) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, [key]: value } });
  const updateOptional = (key: string, value: string) => { const next = { ...draft.triggerConfig }; if (value === "__any") delete next[key]; else next[key] = value; setDraft({ ...draft, triggerConfig: next }); };
  const segmentOptions = [{ id: "__any", label: "Any segment" }, ...filterOptions.segments.map((value) => ({ id: value, label: value }))];
  const countryOptions = [{ id: "__any", label: "Any country" }, ...filterOptions.countries.map((value) => ({ id: value, label: value }))];
  return <div className="space-y-5"><div><p className="text-sm font-semibold">Journey trigger</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the real CRM event that enrolls a contact.</p></div><div className="space-y-2"><Label>Trigger event</Label><FlowSelect value={draft.triggerType} onChange={(value) => { const type = value as TriggerType; setDraft({ ...draft, triggerType: type, triggerConfig: configs[type] }); }} options={triggerTypes.map((value) => [value, triggerLabels[value]] as const)} disabled={disabled} /></div>{draft.triggerType === "category_changed" ? <div className="space-y-2"><Label>Email category</Label><FlowSelect value={String(draft.triggerConfig.category || "Needs follow-up")} onChange={(value) => updateConfig("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div> : null}{draft.triggerType === "no_reply" ? <><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Duration</Label><NumberInput min={1} value={draft.triggerConfig.amount} onChange={(value) => updateConfig("amount", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Unit</Label><FlowSelect value={String(draft.triggerConfig.unit || "days")} onChange={(value) => updateConfig("unit", value)} options={[["hours", "Hours"], ["days", "Days"]]} disabled={disabled} /></div></div><ToggleField checked={Boolean(draft.triggerConfig.businessDays)} onChange={(value) => updateConfig("businessDays", value)} label="Count business days only" detail="Skip weekends when evaluating the trigger." disabled={disabled} /></> : null}{draft.triggerType === "lead_added_to_list" ? <div className="space-y-2"><Label>Lead list</Label><FlowSelect value={String(draft.triggerConfig.listId || "Shopify B2B leads")} onChange={(value) => updateConfig("listId", value)} options={flowLeadLists.map(value => [value, value] as const)} disabled={disabled} /></div> : null}{draft.triggerType === "company_segment_changed" ? <div className="space-y-2"><Label>Company segment</Label>{filterOptions.segments.length ? <FlowSelect value={String(draft.triggerConfig.segment || filterOptions.segments[0])} onChange={(value) => updateConfig("segment", value)} options={filterOptions.segments.map((value) => ({ id: value, label: value }))} disabled={disabled} /> : <Input value={String(draft.triggerConfig.segment || "")} onChange={(event) => updateConfig("segment", event.target.value)} placeholder="Enter a CRM segment" disabled={disabled} />}</div> : null}{draft.triggerType === "pipeline_stage_changed" ? <div className="space-y-2"><Label>Pipeline stage</Label><FlowSelect value={String(draft.triggerConfig.stage || "new")} onChange={(value) => updateConfig("stage", value)} options={pipelineStages.map((value) => [value, titleCase(value)] as const)} disabled={disabled} /></div> : null}<div className="space-y-3 border-t pt-4"><div><p className="text-xs font-semibold">Company filters</p><p className="mt-1 text-xs text-muted-foreground">All selected filters must match before enrollment.</p></div>{draft.triggerType !== "company_segment_changed" ? <div className="space-y-2"><Label>Segment</Label><FlowSelect value={String(draft.triggerConfig.segment || "__any")} onChange={(value) => updateOptional("segment", value)} options={segmentOptions} disabled={disabled} /></div> : null}<div className="space-y-2"><Label>Country</Label><FlowSelect value={String(draft.triggerConfig.country || "__any")} onChange={(value) => updateOptional("country", value)} options={countryOptions} disabled={disabled} /></div><div className="space-y-2"><Label>Company status</Label><FlowSelect value={String(draft.triggerConfig.companyStatus || "__any")} onChange={(value) => updateOptional("companyStatus", value)} options={[{ id: "__any", label: "Any status" }, ...companyStatuses.map((value) => ({ id: value, label: titleCase(value) }))]} disabled={disabled} /></div><div className="space-y-2"><Label>Pipeline stage filter</Label><FlowSelect value={String(draft.triggerConfig.pipelineStage || "__any")} onChange={(value) => updateOptional("pipelineStage", value)} options={[{ id: "__any", label: "Any stage" }, ...pipelineStages.map((value) => ({ id: value, label: titleCase(value) }))]} disabled={disabled} /></div><div className="space-y-2"><Label>Minimum fit score</Label><NumberInput min={0} value={draft.triggerConfig.minFitScore ?? 0} onChange={(value) => { const next = { ...draft.triggerConfig }; if (value <= 0) delete next.minFitScore; else next.minFitScore = value; setDraft({ ...draft, triggerConfig: next }); }} disabled={disabled} /></div></div><div className="rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Enrollment:</strong> Each conversation can have only one active run in this flow.</div></div>;
}

function BaseStepInspector({ type, config, onChange, mailboxes, members, disabled }: { type: FlowStepType; config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; members: Option[]; disabled: boolean }) {
  const set = (key: string, value: string | number | boolean | null) => onChange({ ...config, [key]: value });
  return <div className="space-y-5"><div><p className="text-sm font-semibold">{stepLabels[type]}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{stepMeta[type].description}</p></div>{type === "ai_auto_reply" ? <AiReplyInspector config={config} onChange={onChange} mailboxes={mailboxes} disabled={disabled} /> : null}{type === "wait" ? <><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Duration</Label><NumberInput min={1} value={config.amount} onChange={(value) => set("amount", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Unit</Label><FlowSelect value={String(config.unit || "days")} onChange={(value) => onChange({ ...config, unit: value, ...(value !== "days" ? { businessDays: false, resumeAt: "" } : {}) })} options={[["minutes", "Minutes"], ["hours", "Hours"], ["days", "Days"]]} disabled={disabled} /></div></div><ToggleField checked={Boolean(config.businessDays)} onChange={(value) => set("businessDays", value)} label="Business days only" detail="Skip Saturday and Sunday." disabled={disabled} /><div className="space-y-2"><Label>Resume at (UTC, optional)</Label><Input type="time" value={String(config.resumeAt ?? "")} onChange={(event) => set("resumeAt", event.target.value)} disabled={disabled} /></div></> : null}{type === "if_condition" ? <><div className="space-y-2"><Label>Condition</Label><FlowSelect value={String(config.field || "customer_replied")} onChange={(value) => onChange({ ...config, field: value, ...(value === "category_is" && !config.category ? { category: "Needs follow-up" } : {}) })} options={conditionFields} disabled={disabled} /></div>{config.field === "category_is" ? <div className="space-y-2"><Label>Category</Label><FlowSelect value={String(config.category || "Needs follow-up")} onChange={(value) => set("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div> : null}<div className="space-y-2"><Label>Lookback window</Label><div className="flex items-center gap-2"><NumberInput min={1} value={config.lookbackDays ?? 7} onChange={(value) => set("lookbackDays", value)} disabled={disabled} /><span className="text-xs text-muted-foreground">days</span></div></div><div className="space-y-2"><Label>If matched</Label><FlowSelect value={String(config.action || "stop_flow")} onChange={(value) => set("action", value)} options={conditionActions} disabled={disabled} /></div></> : null}{type === "send_email" ? <><div className="space-y-2"><Label>Email template</Label><FlowSelect value={String(config.templateId || "")} onChange={(value) => set("templateId", value)} options={templates} placeholder="Choose a template" disabled={disabled} /></div><div className="space-y-2"><Label>Sender mailbox</Label><FlowSelect value={String(config.mailboxId || "")} onChange={(value) => set("mailboxId", value)} options={mailboxes} placeholder="Choose a mailbox" disabled={disabled} /></div><div className="space-y-2"><Label>Subject override</Label><Input value={String(config.subject || "")} onChange={(event) => set("subject", event.target.value)} placeholder="Use template subject" disabled={disabled} /></div><div className="space-y-2"><Label>Message override (optional)</Label><Textarea value={String(config.body || "")} onChange={(event) => { const next = { ...config }; if (event.target.value.trim()) next.body = event.target.value; else delete next.body; onChange(next); }} placeholder="Use template message. Supports {{first_name}} and https:// links." disabled={disabled} /></div><div className="space-y-2"><Label>Preheader</Label><Input value={String(config.preheader || "")} onChange={(event) => set("preheader", event.target.value)} placeholder="Inbox preview text" disabled={disabled} /></div><div className="space-y-2"><Label>Send window</Label><FlowSelect value={String(config.sendWindow || "business_hours")} onChange={(value) => set("sendWindow", value)} options={[["business_hours", "Business hours (09:00–17:00 UTC)"], ["anytime", "Any time"]]} disabled={disabled} /></div><div className="space-y-2"><ToggleField checked={Boolean(config.replyInThread)} onChange={(value) => set("replyInThread", value)} label="Reply in same thread" disabled={disabled} /><ToggleField checked={config.trackOpens !== false} onChange={(value) => set("trackOpens", value)} label="Track opens" disabled={disabled} /><ToggleField checked={config.trackClicks !== false} onChange={(value) => set("trackClicks", value)} label="Track link clicks" disabled={disabled} /><ToggleField checked={config.utmTracking !== false} onChange={(value) => set("utmTracking", value)} label="Add UTM tracking" disabled={disabled} /><ToggleField checked={config.stopOnReply !== false} onChange={(value) => set("stopOnReply", value)} label="Stop if customer replies" disabled={disabled} /></div></> : null}{type === "create_task" ? <><div className="space-y-2"><Label>Task title</Label><Input value={String(config.title || "")} onChange={(event) => set("title", event.target.value)} disabled={disabled} /></div><div className="space-y-2"><Label>Assign to</Label><FlowSelect value={String(config.assigneeType || "owner")} onChange={(value) => set("assigneeType", value)} options={[["owner", "Conversation owner"], ["user", "Specific user"]]} disabled={disabled} /></div>{config.assigneeType === "user" ? <div className="space-y-2"><Label>Team member</Label><FlowSelect value={String(config.assigneeId || "")} onChange={(value) => set("assigneeId", value)} options={members} placeholder="Choose a user" disabled={disabled} /></div> : null}<div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Due in days</Label><NumberInput value={config.dueInDays} onChange={(value) => set("dueInDays", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Priority</Label><FlowSelect value={String(config.priority || "normal")} onChange={(value) => set("priority", value)} options={[["low", "Low"], ["normal", "Normal"], ["high", "High"]]} disabled={disabled} /></div></div><div className="space-y-2"><Label>Notes</Label><Textarea value={String(config.notes || "")} onChange={(event) => set("notes", event.target.value)} placeholder="Instructions for the assignee" disabled={disabled} /></div></> : null}{type === "change_category" ? <><div className="space-y-2"><Label>New category</Label><FlowSelect value={String(config.category || "Needs follow-up")} onChange={(value) => set("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div><div className="space-y-2"><Label>Internal reason</Label><Textarea value={String(config.reason || "")} onChange={(event) => set("reason", event.target.value)} placeholder="Why this category is applied" disabled={disabled} /></div></> : null}{type === "internal_alert" ? <><div className="space-y-2"><Label>Notify</Label><FlowSelect value={String(config.userId || "owner")} onChange={(value) => set("userId", value)} options={[{ id: "owner", label: "Conversation owner" }, ...members]} disabled={disabled} /></div><div className="space-y-2"><Label>Delivery</Label><FlowSelect value={String(config.channel || "in_app")} onChange={(value) => set("channel", value)} options={[["in_app", "In-app notification"], ["email", "Email notification"]]} disabled={disabled} /></div><div className="space-y-2"><Label>Message</Label><Textarea value={String(config.message || "")} onChange={(event) => set("message", event.target.value)} disabled={disabled} /></div><ToggleField checked={config.includeThreadLink !== false} onChange={(value) => set("includeThreadLink", value)} label="Include conversation link" disabled={disabled} /></> : null}{type === "stop" ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Contacts reaching this step leave the flow immediately. Later steps will not run.</div> : null}</div>;
}

function StepInspector(props: { type: FlowStepType; config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; members: Option[]; disabled: boolean }) {
  const { type, config, onChange, disabled } = props;
  const set = (key: string, value: string | number | boolean | null) => onChange({ ...config, [key]: value });
  return <div><BaseStepInspector {...props} />{type === "if_condition" ? <div className="mt-5 space-y-2"><Label>If not matched</Label><FlowSelect value={String(config.unmatchedAction || "continue")} onChange={(value) => set("unmatchedAction", value)} options={conditionActions} disabled={disabled} /></div> : null}{type === "stop" ? <div className="mt-5 space-y-4"><div className="space-y-2"><Label>Reason</Label><Input value={String(config.reason || "")} onChange={(event) => set("reason", event.target.value)} placeholder="Why the automation ends here" disabled={disabled} /></div><div className="space-y-2"><Label>Run outcome</Label><FlowSelect value={String(config.outcome || "completed")} onChange={(value) => set("outcome", value)} options={[["completed", "Completed"], ["cancelled", "Cancelled"]]} disabled={disabled} /></div></div> : null}</div>;
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
    <aside aria-label="Flow actions" className="scroll-surface hidden min-h-0 w-64 shrink-0 overflow-y-auto border-r bg-background p-4 min-[100rem]:block">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-body font-semibold">Actions</h2>
          <p className="mt-1 text-xs text-muted-foreground">Drag to canvas or click to add</p>
        </div>
        <Workflow className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input aria-label="Find a flow action" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Find an action" className="pl-9" />
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
        <AiIcon  />Audit this flow
      </Button>
    </aside>
  );
}

function FlowNode({ step, index, selected, onSelect, onMove, onRemove, onPointerDown, disabled, last }: { step: FlowInput["steps"][number]; index: number; selected: boolean; onSelect: () => void; onMove: (offset: number) => void; onRemove: () => void; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void; disabled: boolean; last: boolean }) {
  const { t } = useLanguage();
  const meta = stepMeta[step.type]; const Icon = meta.icon;
  return <div role="button" tabIndex={0} aria-pressed={selected} aria-label={`${stepLabels[step.type]}, step ${index + 1}. Drag to reorder.`} onPointerDown={onPointerDown} onClick={onSelect} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} className={`group relative w-full touch-none cursor-grab rounded-xl border bg-background p-3 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:shadow-md active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary ring-2 ring-primary/15" : ""}`}><div className="flex items-start gap-2.5"><span className="mt-2.5 text-muted-foreground/65 transition group-hover:text-foreground"><GripVertical className="size-[18px]" /></span><span className={`grid size-10 shrink-0 place-items-center rounded-lg ${meta.tone}`}><Icon className="size-5" strokeWidth={2} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-body font-semibold leading-5 text-foreground">{stepLabels[step.type]}</p><Badge variant="outline" className="min-h-6 px-2 text-xs font-medium" translate="no" data-no-translate>{t(`Step ${index + 1}`)}</Badge></div><p className="mt-0.5 break-words text-sm leading-5 text-muted-foreground">{stepSummary(step.type, step.config)}</p></div><div data-no-drag className="flex gap-0.5 opacity-70 transition group-hover:opacity-100 group-focus-within:opacity-100"><Button type="button" variant="ghost" size="icon-xs" className="size-7 [&_svg]:size-4" onClick={(event) => { event.stopPropagation(); onMove(-1); }} disabled={disabled || index === 0} aria-label="Move up"><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-xs" className="size-7 [&_svg]:size-4" onClick={(event) => { event.stopPropagation(); onMove(1); }} disabled={disabled || last} aria-label="Move down"><ArrowDown /></Button><Button type="button" variant="ghost" size="icon-xs" className="size-7 [&_svg]:size-4" onClick={(event) => { event.stopPropagation(); onRemove(); }} disabled={disabled} aria-label="Remove"><Trash2 /></Button></div></div></div>;
}

function FlowCanvas({ draft, selection, insertAt, canEdit, setSelection, setInsertAt, onAddStep, onMoveStep, onRemoveStep }: { draft: DraftFlow; selection: Selection; insertAt: number | null; canEdit: boolean; setSelection: (selection: Selection) => void; setInsertAt: (position: number | null) => void; onAddStep: (type: FlowStepType, position?: number) => FlowInput["steps"][number] | null; onMoveStep: (index: number, offset: number) => void; onRemoveStep: (index: number) => void }) {
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
  const [paletteDropIndex, setPaletteDropIndex] = useState<number | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; position: CanvasPoint; target: number; index: number } | null>(null);
  const panRef = useRef<{ start: CanvasPoint; origin: CanvasPoint } | null>(null);
  const dragRef = useRef<{ id: string; index: number; start: CanvasPoint; origin: CanvasPoint; element: HTMLDivElement; target: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const triggerId = "__trigger";
  const endId = "__end";

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let previousWidth = 0;
    const resize = () => {
      const width = Math.min(CANVAS_NODE_WIDTH, Math.max(280, viewport.clientWidth - 48));
      setNodeWidth(width);
      const initial = previousWidth === 0;
      const delta = (viewport.clientWidth - previousWidth) / 2;
      setPan((current) => initial
        ? { x: Math.round((viewport.clientWidth - width) / 2 - CANVAS_START_X), y: 0 }
        : { x: current.x + delta, y: current.y });
      previousWidth = viewport.clientWidth;
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

  function changeZoom(nextZoom: number) {
    const next = Math.min(1.5, Math.max(0.45, nextZoom));
    const viewport = viewportRef.current;
    if (!viewport) return setZoom(next);
    const center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    const world = { x: (center.x - pan.x) / zoom, y: (center.y - pan.y) / zoom };
    setPan({ x: center.x - world.x * next, y: center.y - world.y * next });
    setZoom(next);
  }

  function fitView() {
    const viewport = viewportRef.current;
    if (!viewport || !nodes.length) return;
    const left = Math.min(...nodes.map((node) => node.x));
    const top = Math.min(...nodes.map((node) => node.y));
    const right = Math.max(...nodes.map((node) => node.x + node.width));
    const bottom = Math.max(...nodes.map((node) => node.y + node.height));
    const next = Math.min(1, Math.max(0.45, Math.min((viewport.clientWidth - 120) / (right - left), (viewport.clientHeight - 100) / (bottom - top))));
    setZoom(next);
    setPan({ x: (viewport.clientWidth - (right - left) * next) / 2 - left * next, y: (viewport.clientHeight - (bottom - top) * next) / 2 - top * next });
  }

  function startNodeDrag(event: ReactPointerEvent<HTMLDivElement>, index: number) {
    if (!canEdit || event.button !== 0 || (event.target as HTMLElement).closest("[data-no-drag]")) return;
    event.stopPropagation();
    suppressClickRef.current = false;
    const node = layout.steps[index]!;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: node.id, index, start: { x: event.clientX, y: event.clientY }, origin: node, element: event.currentTarget, target: index, moved: false };
  }

  function moveNode(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    const position = { x: drag.origin.x + dx / zoom, y: drag.origin.y + dy / zoom };
    drag.target = flowInsertIndex(position.y + layout.steps[drag.index]!.height / 2, layout.steps.filter((node) => node.id !== drag.id));
    setDragPreview({ id: drag.id, index: drag.index, position, target: drag.target });
  }

  function endNodeDrag(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    suppressClickRef.current = !cancelled && drag.moved;
    setDragPreview(null);
    if (!cancelled && drag.moved && drag.target !== drag.index) {
      setInsertAt(null);
      onMoveStep(drag.index, drag.target - drag.index);
    }
  }

  function startPan(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-canvas-node], [data-canvas-controls]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { start: { x: event.clientX, y: event.clientY }, origin: pan };
    setPanning(true);
  }

  function movePan(event: ReactPointerEvent<HTMLElement>) {
    const active = panRef.current;
    if (!active) return;
    setPan({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y });
  }

  function endPan(event: ReactPointerEvent<HTMLElement>) {
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

  function paletteInsertIndex(event: DragMoveEvent) {
    const viewport = viewportRef.current;
    if (!canEdit || !viewport || event.over?.id !== "flow-canvas" || !(event.activatorEvent instanceof PointerEvent)) return null;
    const rect = viewport.getBoundingClientRect();
    const client = { x: event.activatorEvent.clientX + event.delta.x, y: event.activatorEvent.clientY + event.delta.y };
    if (client.x < rect.left || client.x > rect.right || client.y < rect.top || client.y > rect.bottom) return null;
    const point = canvasPointFromClient(client, { x: rect.left, y: rect.top }, pan, zoom);
    return flowInsertIndex(point.y, layout.steps);
  }

  useDndMonitor({
    onDragMove: (event) => setPaletteDropIndex(paletteInsertIndex(event)),
    onDragOver: (event) => setPaletteDropIndex(paletteInsertIndex(event)),
    onDragCancel: () => setPaletteDropIndex(null),
    onDragEnd: (event) => {
      setPaletteDropIndex(null);
      const type = event.active.data.current?.flowStepType as FlowStepType;
      const index = paletteInsertIndex(event);
      if (index !== null && stepTypes.includes(type)) onAddStep(type, index);
    },
  });

  const connectorNodes = nodes.slice(0, -1).map((node, index) => ({ from: node, to: nodes[index + 1]!, insertAt: index }));
  const indicatorIndex = dragPreview
    ? dragPreview.target > dragPreview.index ? dragPreview.target + 1 : dragPreview.target
    : paletteDropIndex;
  const indicator = indicatorIndex === null ? null : connectorNodes[indicatorIndex];

  // Clipping prevents focus changes from scrolling the canvas behind its pan transform.
  return <main ref={setViewportRef} aria-label="Flow canvas. Drag the background or scroll to pan. Drag actions to reorder the flow." onWheel={moveCanvasWithWheel} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onClickCapture={(event) => { if (suppressClickRef.current) { event.stopPropagation(); suppressClickRef.current = false; } }} className={`relative min-h-0 touch-none overflow-clip bg-muted/10 select-none ${panning ? "cursor-grabbing" : "cursor-grab"}`} style={{ backgroundImage: "radial-gradient(circle, color-mix(in oklch, var(--border), transparent 20%) 1px, transparent 1px), radial-gradient(circle at 50% 0%, rgb(62 207 142 / 0.07), transparent 42%)", backgroundPosition: `${pan.x}px ${pan.y}px, center`, backgroundSize: `${24 * zoom}px ${24 * zoom}px, auto` }}>
    <div className="absolute left-0 top-0 h-[2400px] w-[2400px] origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {connectorNodes.map(({ from, to }, index) => <path key={index} d={`M ${from.x + from.width / 2} ${from.y + from.height} L ${to.x + to.width / 2} ${to.y}`} fill="none" stroke="currentColor" strokeWidth="2" className="text-border" vectorEffect="non-scaling-stroke" />)}
      </svg>
      {connectorNodes.map(({ from, to, insertAt: position }) => <div key={`add-${position}`} data-canvas-node data-flow-insert-at={position} className={`absolute ${insertAt === position ? "z-40" : "z-20"}`} style={{ left: from.x + from.width / 2 - 14, top: (from.y + from.height + to.y) / 2 - 14 }}>
        <DropdownMenu open={insertAt === position} onOpenChange={(open) => setInsertAt(open ? position : null)}>
          <DropdownMenuTrigger onClick={(event) => event.stopPropagation()} disabled={!canEdit} aria-label={`Add action at position ${position + 1}`} className="grid size-7 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition hover:scale-110 hover:border-primary hover:text-primary disabled:opacity-50"><Plus className="size-4" /></DropdownMenuTrigger>
          <DropdownMenuContent data-no-drag align="center" className="w-64">
            {stepTypes.map((type) => { const Icon = stepMeta[type].icon; return <DropdownMenuItem key={type} onClick={() => onAddStep(type, position)}><Icon className="text-muted-foreground" />{stepLabels[type]}</DropdownMenuItem>; })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>)}
      <div data-canvas-node data-flow-node-id={triggerId} className="absolute" style={{ left: triggerPosition.x, top: triggerPosition.y, width: nodeWidth }}><button type="button" onClick={() => setSelection("trigger")} className={`w-full rounded-xl border bg-background p-3 text-left shadow-sm transition-shadow hover:shadow-md ${selection === "trigger" ? "border-primary ring-2 ring-primary/15" : ""}`}><div className="flex items-start gap-2.5"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background"><Workflow className="size-5" strokeWidth={2} /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-body font-semibold leading-5 text-foreground">Trigger</p><Badge variant="outline" className="h-6 px-2.5 text-xs font-medium">Enrollment</Badge></div><p className="mt-0.5 text-sm leading-5 text-muted-foreground">{formatTrigger(draft.triggerType, draft.triggerConfig)}</p><div className="mt-2 flex flex-wrap gap-1.5"><Badge variant="secondary" className="min-h-6 gap-1.5 px-2 text-xs font-medium [&_svg]:size-3.5"><ListFilter />Profile filters</Badge><Badge variant="outline" className="h-auto min-h-6 max-w-full whitespace-normal px-2 text-left text-xs font-medium">One active run per conversation</Badge></div></div></div></button></div>
      {draft.steps.map((step, index) => {
        const id = step.id || `step-${index}`;
        const dragging = dragPreview?.id === id;
        const position = dragging ? dragPreview.position : stepPositions[index]!;
        return <div key={id} data-canvas-node data-flow-node-id={id} className={`absolute ${dragging ? "z-30 opacity-85" : ""}`} style={{ left: position.x, top: position.y, width: nodeWidth }} onPointerMove={moveNode} onPointerUp={endNodeDrag} onPointerCancel={(event) => endNodeDrag(event, true)}>
          <FlowNode step={step} index={index} selected={selection === step.id} onSelect={() => setSelection(step.id!)} onPointerDown={(event) => startNodeDrag(event, index)} onMove={(offset) => { setInsertAt(null); onMoveStep(index, offset); }} onRemove={() => { setInsertAt(null); onRemoveStep(index); }} disabled={!canEdit} last={index === draft.steps.length - 1} />
        </div>;
      })}
      <div data-canvas-node data-flow-node-id={endId} className="absolute" style={{ left: endPosition.x, top: endPosition.y, width: endPosition.width }}><div className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm"><CheckCircle2 className="mr-1 inline size-4" />End of flow</div></div>
      {indicator ? <div data-flow-drop-indicator className="pointer-events-none absolute z-40 flex items-center gap-2" style={{ left: CANVAS_START_X - 12, top: (indicator.from.y + indicator.from.height + indicator.to.y) / 2 - 12, width: nodeWidth + 24 }}><span className="h-0.5 flex-1 bg-primary" /><span className="rounded-full border border-primary bg-background px-3 py-1 text-xs font-semibold text-primary shadow-sm">{dragPreview ? `Move to step ${dragPreview.target + 1}` : `Insert as step ${(paletteDropIndex ?? 0) + 1}`}</span><span className="h-0.5 flex-1 bg-primary" /></div> : null}
    </div>
    <div data-canvas-controls className="absolute bottom-3 right-3 z-50 flex items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur md:bottom-5 md:right-5"><button type="button" onClick={() => changeZoom(zoom - 0.1)} aria-label="Zoom out" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Minus className="size-4" /></button><span translate="no" data-no-translate className="w-11 text-center text-xs font-semibold tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => changeZoom(zoom + 0.1)} aria-label="Zoom in" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-4" /></button><span className="mx-1 h-5 w-px bg-border" /><button type="button" onClick={fitView} aria-label="Fit flow to canvas" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Maximize2 className="size-4" /></button></div>
    <div className="pointer-events-none absolute bottom-4 left-4 hidden rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur lg:block">Drag actions to reorder · Scroll to pan · Ctrl-scroll to zoom</div>
  </main>;
}

export function FlowBuilder({ initialFlows, mailboxOptions, memberOptions, initialFlowId, canEdit: canCreate, viewerId, isAdmin = false, filterOptions }: { initialFlows: AutomationFlow[]; mailboxOptions: Option[]; memberOptions: Option[]; initialFlowId?: string; canEdit: boolean; viewerId: string; isAdmin?: boolean; filterOptions: FilterOptions }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [flows, setFlows] = useState(initialFlows);
  const flowsRef = useRef(flows);
  useEffect(() => { flowsRef.current = flows; }, [flows]);
  const [deletingFlow, setDeletingFlow] = useState<AutomationFlow | null>(null);
  const actionBusy = useRef(false);
  const initial = initialFlowId === "default" ? initialFlows.find((flow) => flow.name === "3-step follow-up" && flow.createdBy === viewerId) : initialFlows.find((flow) => flow.id === initialFlowId);
  const [draft, setDraft] = useState<DraftFlow | null>(initial ? toDraft(initial) : null);
  const [view, setView] = useState<"list" | "builder">(initial ? "builder" : "list");
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
  const [auditOpen, setAuditDialogOpen] = useState(false);
  const canManageFlow = (flow: AutomationFlow) => canCreate && (isAdmin || flow.createdBy === viewerId);
  const canEdit = canCreate && (!draft?.id || flows.some((flow) => flow.id === draft.id && canManageFlow(flow)));

  useEffect(() => {
    const controller = new AbortController();
    function refreshAfterAgentAction(event: Event) {
      const detail = (event as CustomEvent<{ flowId?: string; flowEditorBefore?: FlowInput }>).detail;
      if (!detail?.flowId) return;
      void fetch("/api/flows", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || "Unable to refresh flows.");
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
        .catch(() => { if (!controller.signal.aborted) toast.error("Refresh Flows to see the agent's latest changes."); });
    }
    window.addEventListener("filazoo:agent-action", refreshAfterAgentAction);
    return () => { controller.abort(); window.removeEventListener("filazoo:agent-action", refreshAfterAgentAction); };
  }, []);

  const mailboxes = useMemo(() => [{ id: "owner", label: "Owner's mailbox" }, { id: "default", label: "Default workspace mailbox" }, ...mailboxOptions.filter((option) => option.id !== "owner" && option.id !== "default")], [mailboxOptions]);
  const palette = useMemo(() => stepTypes.filter((type) => `${stepLabels[type]} ${stepMeta[type].description}`.toLowerCase().includes(paletteQuery.toLowerCase())), [paletteQuery]);
  const selectedIndex = draft?.steps.findIndex((step) => step.id === selection) ?? -1;
  const audit = draft ? flowInputSchema.safeParse(draft) : null;

  function openFlow(flow: AutomationFlow) { setDraft(toDraft(flow)); setSelection("trigger"); setView("builder"); setErrors({}); setNotice(""); }
  function updateStep(index: number, config: JsonConfig) { if (!draft) return; setDraft({ ...draft, steps: draft.steps.map((step, i) => i === index ? { ...step, config } : step) }); }
  function moveStep(index: number, offset: number) { if (!draft) return; const target = index + offset; if (target < 0 || target >= draft.steps.length) return; setDraft({ ...draft, steps: reorderFlowSteps(draft.steps, index, target) }); }
  function addStep(type: FlowStepType, position = draft?.steps.length ?? 0) { if (!draft || !canEdit) return null; const step = blankStep(type); const steps = [...draft.steps]; steps.splice(position, 0, step); setDraft({ ...draft, steps }); setSelection(step.id!); setInsertAt(null); return step; }
  function removeStep(index: number) { if (!draft) return; const steps = draft.steps.filter((_, i) => i !== index); setDraft({ ...draft, steps }); setSelection(steps[Math.min(index, steps.length - 1)]?.id || "trigger"); }

  async function setAuditOpen(open: boolean) {
    setAuditDialogOpen(open);
    if (!open || !draft || !canEdit) return;
    setNotice("Running a safe backend test…");
    try {
      const response = await fetch("/api/flows/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flow: draft }) });
      const result = await response.json().catch(() => ({ ok: false, error: "The test returned an invalid response." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Flow test failed.");
      setNotice(`Simulation passed · ${result.trace.length} steps checked. ${result.warnings?.join(" ") || "No messages were sent."}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Flow test failed.");
    }
  }

  async function persist(status: FlowStatus = draft?.status ?? "draft") {
    if (!draft || !canEdit) return;
    const payload = { name: draft.name, triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, status, steps: draft.steps };
    const parsed = flowInputSchema.safeParse(payload);
    if (!parsed.success) { const next: Record<string, string> = {}; parsed.error.issues.forEach((issue) => { const key = issue.path[0] === "steps" ? `step-${String(issue.path[1])}` : String(issue.path[0] || "form"); next[key] ||= issue.message; }); setErrors(next); setNotice(parsed.error.issues[0]?.message || "Complete the highlighted settings before saving."); return; }
    setSaving(true); setErrors({}); setNotice("");
    try { const response = await fetch(draft.id ? `/api/flows/${draft.id}` : "/api/flows", { method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }); const result = await response.json().catch(() => ({ ok: false, error: "The server returned an invalid response." })); if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save flow."); const flow = result.flow as AutomationFlow; setFlows((current) => current.some((item) => item.id === flow.id) ? current.map((item) => item.id === flow.id ? flow : item) : [flow, ...current]); setDraft(toDraft(flow)); setSelection(selectedIndex >= 0 ? flow.steps[selectedIndex]?.id || "trigger" : "trigger"); setNotice(status === "live" ? "Flow is live." : status === "paused" ? "Flow paused." : "All changes saved."); toast.success(status === "live" ? "Automation turned on" : status === "paused" ? "Automation paused" : "Flow saved"); } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save flow."); } finally { setSaving(false); }
  }

  async function removeFlow(flow: AutomationFlow) {
    if (!canManageFlow(flow)) return;
    const response = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({ ok: false }));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to delete flow.");
    setFlows((current) => current.filter((item) => item.id !== flow.id));
    if (draft?.id === flow.id) { setDraft(null); setView("list"); }
    toast.success("Flow deleted");
  }

  async function duplicateFlow(flow: AutomationFlow) {
    if (!canCreate || actionBusy.current) return;
    actionBusy.current = true;
    try {
      const payload = { ...toDraft(flow), id: undefined, name: `${flow.name} copy`, status: "draft" as const, steps: flow.steps.map((step) => ({ type: step.type, config: step.config })) };
      const response = await fetch("/api/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to duplicate flow.");
      setFlows((current) => [result.flow, ...current]);
      openFlow(result.flow);
      toast.success("Flow duplicated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to duplicate flow. Please retry.");
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
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update flow.");
      setFlows((current) => current.map((item) => item.id === flow.id ? result.flow : item));
      if (draft?.id === flow.id) setDraft(toDraft(result.flow));
      toast.success(status === "live" ? "Automation turned on" : "Automation paused");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update flow. Please retry.");
    } finally {
      actionBusy.current = false;
    }
  }

  async function runBulkAction(ids: string[], action: FlowBulkAction): Promise<FlowBulkResult[]> {
    if (!canCreate || actionBusy.current) throw new Error("Another flow action is in progress.");
    actionBusy.current = true;
    try {
      const response = await fetch("/api/flows/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action }) });
      const result = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update flows.");
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

  if (view === "list" || !draft) return <><FlowListView flows={flows} canEdit={canCreate} viewerId={viewerId} isAdmin={isAdmin} memberOptions={memberOptions} onBulkAction={runBulkAction} onCreate={() => { setDraft(newDraft()); setSelection("trigger"); setView("builder"); }} onOpen={openFlow} onDuplicate={duplicateFlow} onChangeStatus={changeStatus} onRemove={async (flow) => { setDeletingFlow(flow); }} /><ConfirmActionDialog open={Boolean(deletingFlow)} onOpenChange={(open) => { if (!open) setDeletingFlow(null); }} title="Delete flow?" description={`Delete “${deletingFlow?.name ?? ""}” and its run history? This cannot be undone.`} onConfirm={async () => { if (deletingFlow) await removeFlow(deletingFlow); }} /></>;

  const selectedStep = selectedIndex >= 0 ? draft.steps[selectedIndex] : null;
  const savedFlow = flows.find((flow) => flow.id === draft.id);
  const hasUnsavedChanges = !savedFlow || JSON.stringify(draft) !== JSON.stringify(toDraft(savedFlow));
  return <div data-ai-flow-id={draft.id} data-ai-flow-draft={JSON.stringify({ name: draft.name, triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, status: draft.status, steps: draft.steps })} data-ai-flow-unsaved={hasUnsavedChanges} data-ai-flow-step-id={selection} className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 [&>header]:static! [&>header]:shrink-0">
    <header className="sticky top-12 z-20 flex min-h-14 flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur"><button type="button" onClick={() => setView("list")} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Flows</button><ChevronRight className="size-3.5 text-muted-foreground" /><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-label="Flow name" className="h-8 min-w-0 flex-1 sm:w-64 sm:flex-none border-transparent px-2 text-sm font-semibold hover:border-input focus:border-input" disabled={!canEdit} /><Badge variant={statusVariant(draft.status)} className="capitalize">{draft.status}</Badge><span className="hidden text-xs text-muted-foreground xl:inline">{draft.steps.length} actions · {draft.activeRuns || 0} active</span><div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto"><Button variant="ghost" size="sm" onClick={() => setAuditOpen(true)} disabled={!canEdit}><AiIcon  />Audit flow</Button><Button variant="outline" size="sm" onClick={() => setEmailTestOpen(true)} disabled={!canCreate}><Mail />Test with emails</Button><Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}><Eye />Preview</Button><Button variant="outline" size="sm" onClick={() => void persist(draft.status)} disabled={!canEdit || saving}><Save />{saving ? "Saving…" : "Save"}</Button>{draft.status === "live" ? <Button size="sm" variant="secondary" onClick={() => void persist("paused")} disabled={!canEdit || saving}><Pause />Pause</Button> : <Button size="sm" onClick={() => void persist("live")} disabled={!canEdit || saving}><Play />Turn on</Button>}</div></header>
    {!canEdit ? <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{canCreate ? "Shared flow is read-only. Its creator or an administrator can change it." : "Viewer access is read-only."}</div> : null}
    <div className="flex shrink-0 gap-2 border-b bg-background px-4 py-2 md:hidden" role="group" aria-label="Flow workspace view">
      <Button variant={mobileBuilderPanel === "canvas" ? "secondary" : "ghost"} className="flex-1" aria-pressed={mobileBuilderPanel === "canvas"} onClick={() => setMobileBuilderPanel("canvas")}><Workflow />Canvas</Button>
      <Button variant={mobileBuilderPanel === "settings" ? "secondary" : "ghost"} className="flex-1" aria-pressed={mobileBuilderPanel === "settings"} onClick={() => setMobileBuilderPanel("settings")}><Settings2 />Configure / Insights</Button>
    </div>
    <DndContext id="flow-action-palette" sensors={sensors} collisionDetection={pointerWithin} autoScroll={false}>
    <div data-mobile-panel={mobileBuilderPanel} className="crm-flow-workspace grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,42%)] overflow-hidden lg:flex lg:flex-nowrap [&>main]:min-w-0 [&>main]:flex-1">
      <FlowActionPalette
        canEdit={canEdit}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        actions={palette}
        onAdd={(type) => addStep(type, insertAt ?? draft.steps.length)}
        onAudit={() => setAuditOpen(true)}
      />
      <FlowCanvas key={draft.id || "new-flow"} draft={draft} selection={selection} insertAt={insertAt} canEdit={canEdit} setSelection={(value) => { setSelection(value); setMobileBuilderPanel("settings"); }} setInsertAt={setInsertAt} onAddStep={addStep} onMoveStep={moveStep} onRemoveStep={removeStep} />
      <aside className="scroll-surface min-h-0 overflow-y-auto border-t bg-background lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0 xl:w-[360px]"><Tabs value={inspectorTab} onValueChange={setInspectorTab} className="min-h-full gap-0"><TabsList variant="line" className="sticky top-0 z-10 h-12 w-full justify-start border-b bg-background px-4"><TabsTrigger value="configure"><Settings2 />Configure</TabsTrigger><TabsTrigger value="insights"><History />Insights</TabsTrigger></TabsList><TabsContent value="configure" className="p-4 sm:p-5">{selection === "trigger" ? <><TriggerInspector draft={draft} setDraft={setDraft} filterOptions={filterOptions} disabled={!canEdit} />{errors.triggerConfig ? <p className="mt-4 text-xs text-destructive">{errors.triggerConfig}</p> : null}</> : selectedStep ? <><StepInspector type={selectedStep.type} config={selectedStep.config} onChange={(config) => updateStep(selectedIndex, config)} mailboxes={mailboxes} members={memberOptions} disabled={!canEdit} />{errors[`step-${selectedIndex}`] ? <p className="mt-4 text-xs text-destructive">{errors[`step-${selectedIndex}`]}</p> : null}<div className="mt-6 flex gap-2 border-t pt-4"><Button variant="outline" size="sm" onClick={() => { if (!draft) return; const copy = { ...selectedStep, id: crypto.randomUUID(), config: { ...selectedStep.config } }; const steps = [...draft.steps]; steps.splice(selectedIndex + 1, 0, copy); setDraft({ ...draft, steps }); setSelection(copy.id!); }} disabled={!canEdit}><Copy />Duplicate</Button><Button variant="destructive" size="sm" onClick={() => removeStep(selectedIndex)} disabled={!canEdit}><Trash2 />Remove</Button></div></> : null}</TabsContent><TabsContent value="insights" className="p-4 sm:p-5"><FlowInsights key={draft.id} flowId={draft.id} /></TabsContent></Tabs>{notice ? <div className="sticky bottom-0 border-t bg-background px-5 py-3 text-xs text-muted-foreground" role="status">{notice}</div> : null}</aside>
    </div>
    <FlowPaletteOverlay />
    </DndContext>
    {emailTestOpen ? <FlowEmailTestDialog flow={draft} open={emailTestOpen} onOpenChange={setEmailTestOpen} /> : null}
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Preview · {draft.name}</DialogTitle><DialogDescription>Review the customer journey before turning it on.</DialogDescription></DialogHeader><div className="max-h-[60vh] space-y-2 overflow-auto rounded-lg bg-muted/30 p-4"><PreviewRow icon={Workflow} title="Trigger" detail={formatTrigger(draft.triggerType, draft.triggerConfig)} />{draft.steps.map((step, index) => <PreviewRow key={step.id || index} icon={stepMeta[step.type].icon} title={`${index + 1}. ${stepLabels[step.type]}`} detail={stepSummary(step.type, step.config)} />)}</div><DialogFooter showCloseButton><Button onClick={() => { setPreviewOpen(false); void persist("live"); }} disabled={!canEdit}><Play />Turn on flow</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={auditOpen} onOpenChange={setAuditOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><AiIcon className="size-4 text-violet-600" />Flow audit</DialogTitle><DialogDescription>Checks configuration, safety, and customer experience.</DialogDescription></DialogHeader><div className="space-y-2"><AuditRow ok={Boolean(draft.name.trim())} label="Flow has a clear name" /><AuditRow ok={draft.steps.length > 0} label={`${draft.steps.length} action${draft.steps.length === 1 ? "" : "s"} configured`} /><AuditRow ok={draft.steps.some((step) => step.type === "wait")} label="Includes pacing between messages" /><AuditRow ok={!draft.steps.some((step) => step.type === "send_email") || draft.steps.filter((step) => step.type === "send_email").every((step) => step.config.stopOnReply !== false)} label="Email steps stop when a customer replies" /><AuditRow ok={Boolean(audit?.success)} label={audit?.success ? "All required settings are complete" : "Some required settings need attention"} /></div>{notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}<DialogFooter showCloseButton><Button onClick={() => { setAuditOpen(false); if (!audit?.success) setNotice("Review the highlighted step settings."); }}><Check />Review complete</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function FlowListView({ flows, canEdit, viewerId, isAdmin, memberOptions, onCreate, onOpen, onDuplicate, onChangeStatus, onRemove, onBulkAction }: {
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
    if (uniqueIds.length > 100) { toast.error(t("Select up to 100 flows at a time.")); return; }
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
      if (errors.length) toast.error(t("Some flows could not be updated. Review the errors below."));
      else toast.success(t(action === "delete" ? "Selected flows deleted." : action === "live" ? "Selected flows turned on." : "Selected flows paused."));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update flows.";
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
          <div><h1 className="text-xl font-semibold tracking-tight">Flows</h1><p className="mt-1 text-sm text-muted-foreground">Build, monitor, and improve automated customer journeys.</p></div>
        </div>
        <Button size="lg" onClick={onCreate} disabled={!canEdit || bulkBusy} className="shadow-sm"><Plus />Create flow</Button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <FlowSummary icon={Workflow} label="Live flows" value={liveFlows} detail={`${flows.length} total`} tone="bg-primary/10 text-primary" />
        <FlowSummary icon={Play} label="Active runs" value={activeRuns} detail="Currently in progress" tone="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
        <FlowSummary icon={CheckCircle2} label="Completed" value={completedRuns} detail="All-time journeys" tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" />
      </div>

      
        <div className="mt-6 mb-3 flex items-center justify-between">
          <div><h2 className="text-sm font-semibold">All flows</h2><p className="mt-0.5 text-xs text-muted-foreground">All workspace flows. Select a flow to view its canvas and configuration.</p></div>
          <Badge variant="secondary" className="tabular-nums">{flows.length}</Badge>
        </div>

      <Card className="crm-table-frame crm-table-page-wide gap-0 py-0">
        {selectedFlows.length ? <div role="group" aria-label="Bulk flow actions" aria-busy={bulkBusy} className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-3">
          <span className="mr-auto text-sm font-semibold">{t(`${selectedFlows.length} selected`)}</span>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void applyBulk("live")}><Play />Turn on</Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void applyBulk("paused")}><Pause />Pause</Button>
          <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => setDeleteOpen(true)}><Trash2 />Delete</Button>
          <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelectedIds([])}>Clear selection</Button>
        </div> : null}
        {bulkErrors.length ? <div role="alert" className="max-h-48 overflow-auto border-b bg-destructive/5 px-4 py-3 text-sm"><p className="font-medium">Some flows could not be updated. Review the errors below.</p><ul className="mt-2 list-disc space-y-1 pl-5">{bulkErrors.map((item) => <li key={item.id}><span translate="no" className="font-medium">{flows.find((flow) => flow.id === item.id)?.name || item.id}</span>: {item.error}</li>)}</ul></div> : null}
        {flows.length ? <>
          <div>
            <Table className="min-w-[1040px]">
              <TableHeader><TableRow className="bg-muted/30 hover:bg-muted/30"><TableHead className="w-12 pl-5"><Checkbox aria-label="Select all editable flows on this page" checked={allPageSelected} indeterminate={!allPageSelected && somePageSelected} disabled={bulkBusy || !selectablePage.length} onCheckedChange={(checked) => selectFlows(checked ? [...new Set([...selectedFlows.map((flow) => flow.id), ...selectablePage.map((flow) => flow.id)])] : selectedIds.filter((id) => !selectablePage.some((flow) => flow.id === id)))} /></TableHead><TableHead>Flow</TableHead><TableHead>Created by</TableHead><TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead className="text-center">Active</TableHead><TableHead className="text-center">Completed</TableHead><TableHead>Last updated</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
              <TableBody>{visibleFlows.map((flow) => <TableRow key={flow.id} data-state={selectedIds.includes(flow.id) ? "selected" : undefined} className="group cursor-pointer" onClick={() => { if (!bulkBusy) onOpen(flow); }}><TableCell className="pl-5" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`Select ${flow.name}`} checked={selectedIds.includes(flow.id)} disabled={bulkBusy || !canManage(flow)} onCheckedChange={(checked) => selectFlows(checked ? [...selectedFlows.map((item) => item.id), flow.id] : selectedIds.filter((id) => id !== flow.id))} /></TableCell><TableCell><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Workflow className="size-4" /></span><div><p className="font-semibold group-hover:text-primary">{flow.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{t(`${flow.steps.length} actions`)}</p></div></div></TableCell><TableCell className="text-sm">{memberLabels.get(flow.createdBy) || (flow.createdBy === viewerId ? "You" : "Workspace member")}</TableCell><TableCell><p className="max-w-64 truncate text-sm">{formatTrigger(flow.triggerType, flow.triggerConfig)}</p></TableCell><TableCell><FlowStatusBadge status={flow.status} /></TableCell><TableCell className="text-center font-medium tabular-nums">{flow.activeRuns || 0}</TableCell><TableCell className="text-center font-medium tabular-nums">{flow.completedRuns || 0}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateFormatter.format(new Date(flow.updatedAt))}</TableCell><TableCell><FlowActions flow={flow} canEdit={canManage(flow) && !bulkBusy} canDuplicate={canEdit && !bulkBusy} onOpen={onOpen} onDuplicate={onDuplicate} onChangeStatus={onChangeStatus} onRemove={onRemove} /></TableCell></TableRow>)}</TableBody>
            </Table>
          </div>



        </> : <div className="grid min-h-64 place-items-center px-6 py-12 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Workflow className="size-5" /></span><h3 className="mt-4 font-semibold">Create your first flow</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Automate timely follow-ups, internal tasks, and customer journey decisions.</p><Button className="mt-5" onClick={onCreate} disabled={!canEdit}><Plus />Create flow</Button></div></div>}
      </Card>
      <TablePagination className="mt-6" page={currentPage} pageCount={pageCount} total={flows.length} itemLabel="flows" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} />
      <ConfirmActionDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete selected flows?" description={t("Delete the selected flows and their run history? This cannot be undone.")} onConfirm={() => applyBulk("delete")} />
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

function PreviewRow({ icon: Icon, title, detail }: { icon: typeof Mail | typeof AiIcon; title: string; detail: string }) { return <div className="flex items-center gap-3 rounded-lg border bg-background p-3"><span className="grid size-8 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></span><div><p className="text-xs font-semibold">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{detail}</p></div></div>; }
function AuditRow({ ok, label }: { ok: boolean; label: string }) { return <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5"><span className={`grid size-6 place-items-center rounded-full ${ok ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}</span><span className="text-sm">{label}</span></div>; }
