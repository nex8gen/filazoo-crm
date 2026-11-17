"use client";
import "./workflow-editor.css";
import { NotificationToast } from "@/components/ui/notification-toast";

import { CustomerTagBadge, CustomerTagLabel } from "@/components/customer-tag-badges";
import { isCustomerTag } from "@/lib/customer-tags";

import { FlowSenderField } from "@/components/flow-sender-field";
import { visibleFlowSender, flowSenderOptions, type FlowMailboxOption } from "@/lib/flow-mailboxes";

import { EmptyState } from "@/components/data-state";
import { PageActions } from "@/components/page-header";
import { FlowViewToggle, type FlowCollectionView } from "@/components/flow-view-toggle";
import { FlowDesignPreview } from "@/components/flow-design-preview";
import { UserAvatar } from "@/components/user-avatar";
import { useLanguage } from "@/components/language-provider";

import { AiIcon } from "@/components/ai-icon";

import { lazy, Suspense, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ComponentProps, type Ref, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDndContext, useDndMonitor, useDraggable, useDroppable, useSensor, useSensors, type DragMoveEvent } from "@dnd-kit/core";
import {
  AlertTriangle, ArrowDown, ArrowUp, Bell, Check, CheckCircle2,
  CircleStop, Clock3, Copy, Eye, GitBranch, History, ListFilter, Mail, MoreHorizontal, MoreVertical,
  Building2, ChartNoAxesCombined, ChevronDown, GripVertical, Maximize2, Minus, PanelLeft, Pause, Play, Plus, Save, Search, Settings2, Tag, Trash2, UserRoundCheck, Workflow, X, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { FlowActionPicker, type FlowActionChoice } from "@/components/flow-action-picker";
import { FlowOutline } from "@/components/flow-outline";
import { FlowAlertsBell, FlowAlertsPanel } from "@/components/flow-alerts-panel";
import { flowAlertKey, flowAlerts, partitionFlowAlerts, type FlowAlert } from "@/lib/flow-alerts";
import { FlowActionCard } from "@/components/flow-action-card";
import { FlowConnector } from "@/components/flow-connector";
import { FLOW_MINIMAP_TARGETS, flowMinimapBounds, measureFlowMinimap, type FlowMinimap } from "@/lib/flow-minimap";
import { useFlowConnectorHealth } from "@/components/use-flow-connector-health";
import type { FlowConnectorHealth } from "@/lib/flow-connector-health";
import { FlowInsights } from "@/components/flow-insights";
import { FlowTriggerPanel } from "@/components/flow-trigger-panel";
import { FlowWaitPanel } from "@/components/flow-wait-panel";
import { FlowEmailPanel } from "@/components/flow-email-panel";
import { FlowEmailPerformanceProvider } from "@/components/flow-email-performance";
import { FlowEmailActionCard } from "@/components/flow-email-action-card";
import { FlowPanelSaveControls } from "@/components/flow-panel-save-controls";
import { flowEditorChanged, flowEditorEqual, flowEditorSnapshot, restoreFlowEditor, type FlowEditorSnapshot, type FlowPanelEditor } from "@/lib/flow-editor-session";
import { waitSummary } from "@/lib/flow-wait-editor";
import { triggerProfileSummary } from "@/lib/flow-trigger-editor";
import { FlowConditionEditor } from "@/components/flow-condition-editor";
import { auditFlowDefinition } from "@/lib/flow-audit";
import { editFlowSiblings, flowActionLocations, flowActionTrail, flowSplitLayout, flowNodeWidth, dropFlowAction, type FlowDropTarget } from "@/lib/flow-tree";
import type { FlowPreviewResult } from "@/lib/flow-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { Textarea } from "@/components/ui/textarea";
import {
  blankStep, cloneFlowStep, companyStatuses, defaultFlowInput, emailCategories, flowActionConfigIssue, flowInputSchema, formatTrigger, stepLabels, stepTypes,
  type AutomationFlow, type FlowInput, type FlowStatus, type FlowStepType,
  type JsonConfig, type FlowBulkAction, type FlowBulkResult,
} from "@/lib/flows";
import {
  CANVAS_NODE_WIDTH, CANVAS_START_X, FLOW_NODE_GAP, canvasPointFromClient, canPanFlowCanvas, canHandleFlowCanvasWheel,
  flowInsertIndex, layoutFlowNodes, reorderFlowSteps, fitFlowCanvas, MIN_FLOW_ZOOM, type CanvasPoint,
} from "@/lib/flow-canvas";

const LazyScenarioLab = lazy(() => import("@/components/flow-scenario-lab").then((module) => ({ default: module.FlowScenarioLab })));
const LazyStarterDialog = lazy(() => import("@/components/flow-starter-dialog").then((module) => ({ default: module.FlowStarterDialog })));
const LazyJourneyPreview = lazy(() => import("@/components/flow-journey-preview").then((module) => ({ default: module.FlowJourneyPreview })));
const LazyFlowCheckDialog = lazy(() => import("@/components/flow-check-dialog").then((module) => ({ default: module.FlowCheckDialog })));
const LazyEmailTestDialog = lazy(() => import("@/components/flow-email-test-dialog").then((module) => ({ default: module.FlowEmailTestDialog })));

function FlowJourneyPreview(props: ComponentProps<typeof LazyJourneyPreview>) {
  return <Suspense fallback={<aside className="border-l p-5 text-sm lg:w-[360px]" role="status">Loading…</aside>}><LazyJourneyPreview {...props} /></Suspense>;
}
function FlowEmailTestDialog(props: ComponentProps<typeof LazyEmailTestDialog>) {
  return <Suspense fallback={null}><LazyEmailTestDialog {...props} /></Suspense>;
}

type Option = { id: string; label: string; disabled?: boolean; avatarUrl?: string };
const flowNameClassName = "rounded-sm text-left text-sm font-normal leading-5 text-[#1677ff] hover:text-[#0958d9] hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-400 dark:hover:text-blue-300";
function flowActionLabel(type: FlowStepType) { return type === "wait" ? "Time delay" : type === "send_email" ? "Email" : stepLabels[type]; }
type FilterOptions = { segments: string[]; countries: string[] };
type DraftFlow = FlowInput & { id: string | null; activeRuns?: number; completedRuns?: number; updatedAt?: string; editorRevision?: number };
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

const actionChoices: FlowActionChoice[] = stepTypes.filter((type) => type !== "if_condition").map((type) => { const meta = stepMeta[type], Icon = meta.icon; return { type, label: flowActionLabel(type), description: meta.description, group: meta.group, tone: meta.tone, icon: <Icon className="size-4" /> }; });

function toDraft(flow: AutomationFlow): DraftFlow {
  const definition = flow.editorDraft?.definition ?? flow;
  return { id: flow.id, name: definition.name, triggerType: definition.triggerType, triggerConfig: { ...definition.triggerConfig }, status: flow.status, activeRuns: flow.activeRuns, completedRuns: flow.completedRuns, updatedAt: flow.updatedAt, editorRevision: flow.editorDraft?.revision ?? 0, steps: definition.steps.map((step) => ({ id: step.id, type: step.type, config: { ...step.config } })) };
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
    <div className="rounded-lg bg-violet-50 p-3 text-xs leading-5 text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">Reads the submitted form requirements and latest customer conversation before sending.</div>
    <FlowSenderField value={String(config.mailboxId || "default")} onChange={(value) => set("mailboxId", value)} options={mailboxes} disabled={disabled} />
    <div className="space-y-2"><Label>Reply language</Label><p className="text-sm text-muted-foreground">English for every automated reply.</p></div>
    <div className="space-y-2"><Label>Reply instructions</Label><Textarea value={String(config.instructions || "")} onChange={(event) => set("instructions", event.target.value)} maxLength={4000} placeholder="Answer the customer's questions and ask about their required quantities." disabled={disabled} /></div>
    <div className="space-y-2">
      <ToggleField checked={Boolean(config.useProducts)} onChange={(value) => onChange({ ...config, useProducts: value, ...(!value ? { usePrices: false } : {}) })} label="Read product information" detail="Use active CRM products, variants, availability and specifications." disabled={disabled} />
      <ToggleField checked={Boolean(config.usePrices)} onChange={(value) => set("usePrices", value)} label="Use saved product prices" detail="Quote verified CRM prices with currency, minimum quantities and quantity breaks." disabled={disabled || !config.useProducts} />
      <ToggleField checked={Boolean(config.attachCatalog)} onChange={(value) => set("attachCatalog", value)} label="Attach product catalog PDF when needed" detail="Attach when requested or when AI identifies a clear product need. Specific product requests include only matching products." disabled={disabled} />
      {config.attachCatalog ? <ToggleField checked={config.catalogFirstMessageOnly !== false} onChange={(value) => set("catalogFirstMessageOnly", value)} label="Also include catalog in the first email" detail="Include it in the first automated email to this lead. Later emails attach only when needed. Customer refusals are respected." disabled={disabled} /> : null}
      <ToggleField checked={config.stopOnReply === true} onChange={(value) => set("stopOnReply", value)} label="Stop if customer replies after this action was triggered" disabled={disabled} /><ToggleField checked={config.replyInThread !== false} onChange={(value) => set("replyInThread", value)} label="Reply in same thread" disabled={disabled} />
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

function statusVariant(status: FlowStatus) { return status === "live" ? "live" : status === "paused" ? "secondary" : "outline"; }
function titleCase(value: unknown) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function stepSummary(type: FlowStepType, config: JsonConfig) {
  if (type === "wait") return waitSummary(config);
  if (type === "split") return `${Array.isArray(config.paths) ? config.paths.length : 0} ordered paths · first match wins`;
  if (type === "ai_auto_reply") return config.attachCatalog ? "English reply + catalog when needed" : "Personalized reply in English";
  if (type === "send_email") return String(config.templateName || templates.find((item) => item.id === config.templateId)?.label || "Choose an email template");
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

function BaseStepInspector({ type, config, onChange, mailboxes, members, disabled }: { type: FlowStepType; config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; members: Option[]; disabled: boolean }) {
  const set = (key: string, value: string | number | boolean | null) => onChange({ ...config, [key]: value });
  return <div className="wf-action-fields"><p className="wf-panel-description">{stepMeta[type].description}</p>{type === "ai_auto_reply" ? <AiReplyInspector config={config} onChange={onChange} mailboxes={mailboxes} disabled={disabled} /> : null}{type === "if_condition" ? <><div className="space-y-2"><Label>Condition</Label><FlowSelect value={String(config.field || "customer_replied")} onChange={(value) => onChange({ ...config, field: value, ...(value === "category_is" && !config.category ? { category: "Quotation Follow-up" } : {}) })} options={conditionFields} disabled={disabled} /></div>{config.field === "category_is" ? <div className="space-y-2"><Label>Category</Label><FlowSelect value={String(config.category || "Quotation Follow-up")} onChange={(value) => set("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div> : null}<div className="space-y-2"><Label>Lookback window</Label><div className="flex items-center gap-2"><NumberInput min={1} value={config.lookbackDays ?? 7} onChange={(value) => set("lookbackDays", value)} disabled={disabled} /><span className="text-xs text-muted-foreground">days</span></div></div><div className="space-y-2"><Label>If matched</Label><FlowSelect value={String(config.action || "stop_flow")} onChange={(value) => set("action", value)} options={conditionActions} disabled={disabled} /></div></> : null}{type === "send_email" ? <><div className="space-y-2"><Label>Email template</Label><FlowSelect value={String(config.templateId || "")} onChange={(value) => set("templateId", value)} options={templates} placeholder="Choose a template" disabled={disabled} /></div><FlowSenderField value={String(config.mailboxId || "default")} onChange={(value) => set("mailboxId", value)} options={mailboxes} disabled={disabled} /><div className="space-y-2"><Label>Subject override</Label><Input value={String(config.subject || "")} onChange={(event) => set("subject", event.target.value)} placeholder="Use template subject" disabled={disabled} /></div><div className="space-y-2"><Label>Message override (optional)</Label><Textarea value={String(config.body || "")} onChange={(event) => { const next = { ...config }; if (event.target.value.trim()) next.body = event.target.value; else delete next.body; onChange(next); }} placeholder="Use template message. Supports {{first_name}} and https:// links." disabled={disabled} /></div><div className="space-y-2"><Label>Preheader</Label><Input value={String(config.preheader || "")} onChange={(event) => set("preheader", event.target.value)} placeholder="Inbox preview text" disabled={disabled} /></div><div className="space-y-2"><Label>Send window</Label><FlowSelect value={String(config.sendWindow || "business_hours")} onChange={(value) => set("sendWindow", value)} options={[["business_hours", "Business hours (09:00–17:00 UTC)"], ["anytime", "Any time"]]} disabled={disabled} /></div><div className="space-y-2"><ToggleField checked={Boolean(config.replyInThread)} onChange={(value) => set("replyInThread", value)} label="Reply in same thread" disabled={disabled} /><ToggleField checked={config.trackOpens !== false} onChange={(value) => set("trackOpens", value)} label="Track opens" disabled={disabled} /><ToggleField checked={config.trackClicks !== false} onChange={(value) => set("trackClicks", value)} label="Track link clicks" disabled={disabled} /><ToggleField checked={config.utmTracking !== false} onChange={(value) => set("utmTracking", value)} label="Add UTM tracking" disabled={disabled} /><ToggleField checked={config.stopOnReply !== false} onChange={(value) => set("stopOnReply", value)} label="Stop if customer replies" disabled={disabled} /></div></> : null}{type === "create_task" ? <><div className="space-y-2"><Label>Task title</Label><Input value={String(config.title || "")} onChange={(event) => set("title", event.target.value)} disabled={disabled} /></div><div className="space-y-2"><Label>Assign to</Label><FlowSelect value={String(config.assigneeType || "owner")} onChange={(value) => set("assigneeType", value)} options={[["owner", "Conversation owner"], ["user", "Specific user"]]} disabled={disabled} /></div>{config.assigneeType === "user" ? <div className="space-y-2"><Label>Team member</Label><FlowSelect value={String(config.assigneeId || "")} onChange={(value) => set("assigneeId", value)} options={members} placeholder="Choose a user" disabled={disabled} /></div> : null}<div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Due in days</Label><NumberInput value={config.dueInDays} onChange={(value) => set("dueInDays", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Priority</Label><FlowSelect value={String(config.priority || "normal")} onChange={(value) => set("priority", value)} options={[["low", "Low"], ["normal", "Normal"], ["high", "High"]]} disabled={disabled} /></div></div><div className="space-y-2"><Label>Notes</Label><Textarea value={String(config.notes || "")} onChange={(event) => set("notes", event.target.value)} placeholder="Instructions for the assignee" disabled={disabled} /></div></> : null}{type === "change_category" ? <><div className="space-y-2"><Label>New tag</Label><FlowSelect value={String(config.category || "Quotation Follow-up")} onChange={(value) => set("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div><div className="space-y-2"><Label>Internal reason</Label><Textarea value={String(config.reason || "")} onChange={(event) => set("reason", event.target.value)} placeholder="Why this tag is applied" disabled={disabled} /></div></> : null}{type === "internal_alert" ? <><div className="space-y-2"><Label>Notify</Label><FlowSelect value={String(config.userId || "owner")} onChange={(value) => set("userId", value)} options={[{ id: "owner", label: "Conversation owner" }, ...members]} disabled={disabled} /></div><div className="space-y-2"><Label>Delivery</Label><FlowSelect value={String(config.channel || "in_app")} onChange={(value) => set("channel", value)} options={[["in_app", "In-app notification"], ["email", "Email notification"]]} disabled={disabled} /></div>{config.channel === "email" ? <FlowSenderField value={String(config.mailboxId || "default")} onChange={(value) => set("mailboxId", value)} options={mailboxes} disabled={disabled} /> : null}<div className="space-y-2"><Label>Message</Label><Textarea value={String(config.message || "")} onChange={(event) => set("message", event.target.value)} disabled={disabled} /></div><ToggleField checked={config.includeThreadLink !== false} onChange={(value) => set("includeThreadLink", value)} label="Include conversation link" disabled={disabled} /></> : null}{type === "stop" ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Contacts reaching this step leave the workflow immediately. Later steps will not run.</div> : null}</div>;
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
  return <div className="wf-action-settings" data-action-kind={type}><BaseStepInspector {...props} />{["send_email", "ai_auto_reply"].includes(type) ? <div className="mt-5 space-y-5 border-t pt-5"><div className="space-y-3"><ToggleField checked={Number(config.smartSendingHours) > 0} onChange={(checked) => set("smartSendingHours", checked ? 16 : 0)} label="Skip recently emailed customers" detail="Checks messages sent by this workflow's owner across their workflows and mailbox." disabled={disabled} />{Number(config.smartSendingHours) > 0 ? <Label className="grid gap-2">Smart Sending window (hours)<NumberInput min={1} value={config.smartSendingHours} onChange={(value) => set("smartSendingHours", Math.min(720, value))} disabled={disabled} /></Label> : null}</div><div className="space-y-3"><p className="text-xs font-semibold">Additional message filters</p><p className="text-xs leading-5 text-muted-foreground">Checked again when this message is due. A failed filter skips this message and continues the journey.</p>{config.filters && typeof config.filters === "object" && !Array.isArray(config.filters) ? <><FlowConditionEditor config={config.filters} onChange={(filters) => onChange({ ...config, filters })} disabled={disabled} /><Button size="sm" variant="ghost" onClick={() => { const next = { ...config }; delete next.filters; onChange(next); }} disabled={disabled}>Remove message filters</Button></> : <Button variant="outline" size="sm" onClick={() => onChange({ ...config, filters: { field: "customer_replied", negate: true } })} disabled={disabled}><Plus />Add message filter</Button>}</div></div> : null}{type === "split" ? <SplitInspector config={config} onChange={onChange} mailboxes={props.mailboxes} members={props.members} disabled={disabled} /> : null}{type === "if_condition" ? <><B2bConditionFields config={config} set={set} disabled={disabled} /><div className="mt-5 space-y-2"><Label>If not matched</Label><FlowSelect value={String(config.unmatchedAction || "continue")} onChange={(value) => set("unmatchedAction", value)} options={conditionActions} disabled={disabled} /></div></> : null}{type === "update_company" ? <UpdateCompanyFields config={config} onChange={onChange} disabled={disabled} /> : null}{type === "stop" ? <div className="mt-5 space-y-4"><div className="space-y-2"><Label>Reason</Label><Input value={String(config.reason || "")} onChange={(event) => set("reason", event.target.value)} placeholder="Why the automation ends here" disabled={disabled} /></div><div className="space-y-2"><Label>Run outcome</Label><FlowSelect value={String(config.outcome || "completed")} onChange={(value) => set("outcome", value)} options={[["completed", "Completed"], ["cancelled", "Cancelled"]]} disabled={disabled} /></div></div> : null}</div>;
}


type FlowActionPaletteProps = {
  canEdit: boolean;
  actions: FlowStepType[];
  onAdd: (type: FlowStepType) => void;
  onClose: () => void;
};

function FlowPaletteAction({ type, canEdit, onAdd }: { type: FlowStepType; canEdit: boolean; onAdd: (type: FlowStepType) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette-${type}`, data: { flowStepType: type }, disabled: !canEdit });
  const { icon: Icon, tone, description } = stepMeta[type];
  return <button ref={setNodeRef} type="button" {...attributes} {...listeners} onClick={() => onAdd(type)} disabled={!canEdit} className={`wf-palette-action flex w-full touch-none cursor-grab items-center text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 ${isDragging ? "opacity-50" : ""}`}>
    <span className={"grid size-9 shrink-0 place-items-center rounded-lg " + tone}><Icon className="size-4" /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium leading-5">{flowActionLabel(type)}</span><span className="sr-only">{description}</span></span>
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

function FlowActionPalette({ canEdit, actions, onAdd, onClose }: FlowActionPaletteProps) {
  return (
    <aside aria-label="Workflow actions" className="wf-panel wf-palette scroll-surface">
      <div className="wf-palette-heading">
        <h2>Actions</h2>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Collapse actions panel" onClick={onClose}><PanelLeft /></Button>
      </div>

      {(["Message", "Data", "Logic"] as const).map((group) => {
        const groupActions = actions.filter((type) => stepMeta[type].group === group);
        if (!groupActions.length) return null;
        return (
          <section key={group} className="wf-action-group" aria-label={group + " actions"}>
            <h3>{group === "Message" ? "Messages" : group}</h3>
            <div className="space-y-1">
              {groupActions.map((type) => <FlowPaletteAction key={type} type={type} canEdit={canEdit} onAdd={onAdd} />)}
            </div>
          </section>
        );
      })}
      {!actions.length ? <EmptyState compact icon={Search} title="No matching actions." className="border-0 bg-transparent" /> : null}
    </aside>
  );
}

type CanvasDragProps = { health?: FlowConnectorHealth; nodeWidth?: number; dropTarget?: FlowDropTarget | null; onActionPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, id: string) => void; onInsertAction?: (type: FlowStepType, target: FlowDropTarget) => void };
type FlowDragInput = { type: FlowStepType } | { actionId: string };

function SplitCanvasNode({ step, index, selected, onSelect, onMove, onRemove, onPointerDown, disabled, last, selection, onSelectAction, onChange, preview, dropTarget, onActionPointerDown, onInsertAction, health, nodeWidth = CANVAS_NODE_WIDTH }: {
  step: FlowInput["steps"][number]; index: number; selected: boolean; onSelect: () => void;
  onMove: (offset: number) => void; onRemove: () => void; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  disabled: boolean; last: boolean; selection?: string; onSelectAction?: (id: string) => void;
  onChange?: (config: JsonConfig) => void; preview?: FlowPreviewResult | null;
} & CanvasDragProps) {
  const paths = splitPaths(step.config);
  const { columnWidths, centers, width } = flowSplitLayout(step.config, nodeWidth);
  const updatePath = (pathIndex: number, next: SplitPath) => onChange?.({ ...step.config, paths: paths.map((path, i) => i === pathIndex ? next : path) as unknown as JsonConfig["paths"] });
  const add = (pathIndex: number, position: number, type: FlowStepType) => {
    onInsertAction?.(type, { branchId: paths[pathIndex].id, index: position });
  };
  const insert = (pathIndex: number, position: number) => <div data-flow-branch-insert-index={position} data-flow-health={health?.actions?.[paths[pathIndex].steps[position]?.id ?? ""]?.state ?? health?.connectionState ?? "idle"} data-flow-drop-indicator={dropTarget?.branchId === paths[pathIndex].id && dropTarget.index === position ? "" : undefined} style={{ height: FLOW_NODE_GAP }} className="wf-branch-insert relative z-20 flex justify-center before:absolute before:inset-y-0 before:left-1/2 before:-translate-x-1/2">{dropTarget?.branchId === paths[pathIndex].id && dropTarget.index === position ? <span className="sr-only">Drop action here</span> : null}<FlowActionPicker items={actionChoices} context={paths[pathIndex].name} label={`Add action to ${paths[pathIndex].name} at position ${position + 1}`} disabled={disabled || paths[pathIndex].steps.length >= 25} onAdd={(type) => add(pathIndex, position, type)} /></div>;
  return <div>
    <FlowActionCard split label={String(step.config.name || "Split")} summary="Checks paths in order · first match wins" icon={<GitBranch className="size-[18px]" />} tone={stepMeta.split.tone} index={index} selected={selected} disabled={disabled} last={last} onSelect={onSelect} onMove={onMove} onRemove={onRemove} onPointerDown={onPointerDown} />
    <div className="wf-split-stem" />
    <div data-no-drag data-flow-split-branches className="relative grid items-stretch" style={{ width, marginLeft: `calc((100% - ${width}px) / 2)`, gridTemplateColumns: `${width}px` }}>
      <svg aria-hidden="true" className="wf-branch-connectors" style={{ top: -FLOW_NODE_GAP / 2, height: FLOW_NODE_GAP, width }}>
        {paths.map((path, index) => <FlowConnector key={path.id} state={health?.actions?.[step.id!]?.state ?? health?.connectionState} actionId={step.id} from={{ x: width / 2, y: 0 }} to={{ x: width / 2 + centers[index], y: FLOW_NODE_GAP }} />)}
      </svg>
      {paths.map((path, pathIndex) => {
        const reached = !preview || preview.trace.some((entry) => entry.pathId === path.id);
        return <div key={path.id} data-flow-branch-id={path.id} style={{ gridArea: "1 / 1", justifySelf: "start", width: columnWidths[pathIndex], marginLeft: width / 2 + centers[pathIndex] - columnWidths[pathIndex] / 2 }} className={`wf-branch-lane relative flex min-w-0 flex-col ${reached ? "" : "opacity-35"}`}>
          <button data-flow-path-header type="button" onClick={onSelect} title={path.condition === null ? "Customers who do not match an earlier path enter here." : conditionSummary(path.condition)} className="wf-path-card"><span className="wf-path-heading"><span className="wf-path-number">{pathIndex + 1}</span><span>Path</span><MoreVertical /></span><strong>{path.name}</strong>{path.condition !== null ? <span className="wf-path-criteria">{conditionSummary(path.condition) || "Add path criteria"}</span> : null}</button>
          {path.steps.map((action, actionIndex) => <div key={action.id || actionIndex}>{insert(pathIndex, actionIndex)}<div data-flow-action-id={action.id}><FlowNode health={health} nodeWidth={nodeWidth} step={action} index={actionIndex} selected={selection === action.id} onSelect={() => onSelectAction?.(action.id!)} onPointerDown={(event) => onActionPointerDown?.(event, action.id!)} dropTarget={dropTarget} onActionPointerDown={onActionPointerDown} onInsertAction={onInsertAction} onMove={(offset) => updatePath(pathIndex, { ...path, steps: reorderFlowSteps(path.steps, actionIndex, actionIndex + offset) })} onRemove={() => { updatePath(pathIndex, { ...path, steps: path.steps.filter((_, i) => i !== actionIndex) }); onSelect(); }} disabled={disabled} last={actionIndex === path.steps.length - 1} selection={selection} onSelectAction={onSelectAction} preview={preview} onSplitChange={(config) => updatePath(pathIndex, { ...path, steps: path.steps.map((item, i) => i === actionIndex ? { ...item, config } : item) })} /></div></div>)}
          {insert(pathIndex, path.steps.length)}
          <div className="mt-auto space-y-2 pb-7 text-center"><span className="inline-flex items-center gap-1.5 bg-background px-2 py-1 text-xs text-muted-foreground">{path.steps.at(-1)?.type === "stop" ? "Workflow ends here" : "Continue after split"}</span><div data-flow-health={health?.connectionState ?? "idle"} className={`wf-branch-tail mx-auto h-7 ${path.steps.at(-1)?.type === "stop" ? "" : "wf-connector-line"}`} /></div>
        </div>;
      })}
      <svg aria-hidden="true" className="wf-branch-connectors" style={{ bottom: -FLOW_NODE_GAP / 2, height: FLOW_NODE_GAP, width }}>
        {paths.map((path, index) => path.steps.at(-1)?.type === "stop" ? null : <FlowConnector key={path.id} state={health?.connectionState} from={{ x: width / 2 + centers[index], y: 0 }} to={{ x: width / 2, y: FLOW_NODE_GAP }} />)}
      </svg>
    </div>
    <div className="wf-split-stem" />
  </div>;
}

function FlowNode({ health, step, index, selected, onSelect, onMove, onRemove, onPointerDown, disabled, last, selection, onSelectAction, onSplitChange, preview, dropTarget, onActionPointerDown, onInsertAction, nodeWidth = CANVAS_NODE_WIDTH }: { selection?: string; onSelectAction?: (id: string) => void; onSplitChange?: (config: JsonConfig) => void; preview?: FlowPreviewResult | null; step: FlowInput["steps"][number]; index: number; selected: boolean; onSelect: () => void; onMove: (offset: number) => void; onRemove: () => void; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void; disabled: boolean; last: boolean } & CanvasDragProps) {
  const meta = stepMeta[step.type]; const Icon = meta.icon;
  if (step.type === "split") return <SplitCanvasNode health={health} nodeWidth={nodeWidth} step={step} index={index} selected={selected} onSelect={onSelect} onMove={onMove} onRemove={onRemove} onPointerDown={onPointerDown} disabled={disabled} last={last} selection={selection} onSelectAction={onSelectAction} onChange={onSplitChange} preview={preview} dropTarget={dropTarget} onActionPointerDown={onActionPointerDown} onInsertAction={onInsertAction} />;
  const ActionCard = step.type === "send_email" ? FlowEmailActionCard : FlowActionCard;
  return <ActionCard actionId={step.id ?? ""} config={step.config} kind={step.type} label={flowActionLabel(step.type)} summary={stepSummary(step.type, step.config)} icon={<Icon className="size-[18px]" />} tone={meta.tone} index={index} selected={selected} disabled={disabled} last={last} onSelect={onSelect} onMove={onMove} onRemove={onRemove} onPointerDown={onPointerDown} />;
}

function flowCanvasArea(viewport: HTMLElement) {
  const bounds = viewport.getBoundingClientRect();
  const safeArea = viewport.parentElement?.querySelector<HTMLElement>("[data-flow-canvas-safe-area]")?.getBoundingClientRect();
  return safeArea && safeArea.width > 0 && safeArea.height > 0
    ? { x: safeArea.left - bounds.left, y: safeArea.top - bounds.top, width: safeArea.width, height: safeArea.height }
    : { x: 0, y: 0, width: viewport.clientWidth, height: viewport.clientHeight };
}

function FlowCanvas({ health, draft, selection, insertAt, canEdit, setSelection, setInsertAt, onAddStep, onMoveStep, onRemoveStep, onUpdateStep, preview, onDropFlowAction, onNavigate, navigationRef }: { navigationRef?: Ref<{ focusAction: (id: string) => void }>; health: FlowConnectorHealth; onNavigate: (id: string) => void; onDropFlowAction: (input: FlowDragInput, target: FlowDropTarget) => void; onUpdateStep: (index: number, config: JsonConfig) => void; preview?: FlowPreviewResult | null; draft: DraftFlow; selection: Selection; insertAt: number | null; canEdit: boolean; setSelection: (selection: Selection) => void; setInsertAt: (position: number | null) => void; onAddStep: (type: FlowStepType, position?: number) => FlowInput["steps"][number] | null; onMoveStep: (index: number, offset: number) => void; onRemoveStep: (index: number) => void }) {
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [minimap, setMinimap] = useState<FlowMinimap>({ nodes: [], connectors: [] });
  const { active } = useDndContext();
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
  const panRef = useRef<{ start: CanvasPoint; origin: CanvasPoint; pointerId: number; moved: boolean } | null>(null);
  const dragRef = useRef<{ id: string; start: CanvasPoint; element: HTMLDivElement; pointerId: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const previousCanvasArea = useRef<ReturnType<typeof flowCanvasArea> | null>(null);
  const [visibleArea, setVisibleArea] = useState<ReturnType<typeof flowCanvasArea> | null>(null);
  const triggerId = "__trigger";
  const endId = "__end";

  useEffect(() => {
    const cancel = () => {
      const drag = dragRef.current;
      const panGesture = panRef.current;
      if (!drag && !panGesture) return;
      dragRef.current = null;
      panRef.current = null;
      if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
      const viewport = viewportRef.current;
      if (panGesture && viewport?.hasPointerCapture(panGesture.pointerId)) viewport.releasePointerCapture(panGesture.pointerId);
      suppressClickRef.current = Boolean(drag?.moved || panGesture?.moved);
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      setPanning(false);
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
      const area = flowCanvasArea(viewport);
      const width = Math.min(CANVAS_NODE_WIDTH, Math.max(280, area.width - 48));
      setNodeWidth(width);
      const previous = previousCanvasArea.current;
      const center = area.x + area.width / 2;
      setPan((current) => previous
        ? { x: current.x + center - previous.x - previous.width / 2, y: current.y + area.y - previous.y }
        : { x: Math.round(center - width / 2 - CANVAS_START_X), y: area.y + 44 });
      viewport.style.setProperty("--wf-canvas-left", `${area.x}px`);
      viewport.style.setProperty("--wf-canvas-top", `${area.y}px`);
      viewport.style.setProperty("--wf-canvas-width", `${area.width}px`);
      viewport.style.setProperty("--wf-canvas-bottom", `${Math.max(0, viewport.clientHeight - area.y - area.height)}px`);
      previousCanvasArea.current = area;
      setVisibleArea(current => current && current.x === area.x && current.y === area.y && current.width === area.width && current.height === area.height ? current : area);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    const safeArea = viewport.parentElement?.querySelector("[data-flow-canvas-safe-area]");
    if (safeArea) observer.observe(safeArea);
    return () => observer.disconnect();
  }, []);

  // Measure the entire split before paint so following root actions cannot cover it.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      setNodeHeights((current) => {
        const next = { ...current };
        let changed = false;
        for (const node of viewport.querySelectorAll<HTMLElement>("[data-flow-node-id]")) {
          const id = node.dataset.flowNodeId;
          if (!node.offsetHeight || !viewport.clientWidth) continue;
          if (id && next[id] !== node.offsetHeight) {
            next[id] = node.offsetHeight;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    viewport.querySelectorAll<HTMLElement>("[data-flow-node-id]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [nodeKeys, draft.steps, draft.triggerConfig, draft.triggerType, nodeWidth]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const next = measureFlowMinimap(content);
      setMinimap(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    content.querySelectorAll(FLOW_MINIMAP_TARGETS).forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [draft.steps, draft.triggerConfig, draft.triggerType, nodeHeights, nodeWidth]);

  const layout = layoutFlowNodes(draft.steps.map((step, index) => step.id || `step-${index}`), nodeHeights, nodeWidth);
  const triggerPosition = layout.trigger;
  const stepPositions = layout.steps;
  const endPosition = layout.end;
  const nodes = [layout.trigger, ...layout.steps, layout.end];
  const layoutReady = nodes.every((node) => nodeHeights[node.id] > 0);

  useEffect(() => {
    if (!preview) return;
    const viewport = viewportRef.current;
    const target = viewport?.querySelector<HTMLElement>(`[data-flow-action-id="${CSS.escape(selection)}"]`);
    if (!viewport || !target) return;
    const bounds = viewport.getBoundingClientRect(), area = flowCanvasArea(viewport), card = target.getBoundingClientRect();
    setPan((current) => ({ x: current.x + bounds.left + area.x + area.width / 2 - card.left - card.width / 2, y: current.y + bounds.top + area.y + area.height / 2 - card.top - card.height / 2 }));
  }, [selection, preview]);

  function changeZoom(nextZoom: number) {
    const next = Math.min(1.5, Math.max(MIN_FLOW_ZOOM, nextZoom));
    const viewport = viewportRef.current;
    if (!viewport) return setZoom(next);
    const area = flowCanvasArea(viewport);
    const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const world = { x: (center.x - pan.x) / zoom, y: (center.y - pan.y) / zoom };
    setPan({ x: center.x - world.x * next, y: center.y - world.y * next });
    setZoom(next);
  }

  function focusAction(id: string) {
    onNavigate(id);
    const viewport = viewportRef.current;
    const node = viewport?.querySelector<HTMLElement>(id === "trigger" ? '[data-flow-node-id="__trigger"]' : `[data-flow-action-id="${CSS.escape(id)}"]`);
    const card = node?.querySelector<HTMLElement>("[data-flow-card], .wf-trigger-card") ?? node;
    if (!viewport || !card) return;
    const area = flowCanvasArea(viewport), bounds = card.getBoundingClientRect(), viewportBounds = viewport.getBoundingClientRect();
    const point = canvasPointFromClient({ x: bounds.left, y: bounds.top }, { x: viewportBounds.left, y: viewportBounds.top }, pan, zoom);
    const nextZoom = Math.min(1, Math.max(MIN_FLOW_ZOOM, (area.width - 64) / (bounds.width / zoom)));
    setZoom(nextZoom);
    setPan({ x: area.x + (area.width - bounds.width / zoom * nextZoom) / 2 - point.x * nextZoom, y: area.y + 96 - point.y * nextZoom });
    card.focus({ preventScroll: true });
  }

  function fitView() {
    const viewport = viewportRef.current;
    if (!viewport || !nodes.length) return;
    const bounds = nodes.map((node) => {
      const step = draft.steps.find((item) => item.id === node.id);
      const branchWidth = step?.type === "split" ? flowNodeWidth(step, nodeWidth) : node.width;
      return { ...node, x: node.x - Math.max(0, branchWidth - node.width) / 2, width: Math.max(node.width, branchWidth) };
    });
    const area = flowCanvasArea(viewport);
    const fitted = fitFlowCanvas(bounds, area);
    setZoom(fitted.zoom);
    setPan({ x: fitted.pan.x + area.x, y: fitted.pan.y + area.y });
  }

  function startNodeDrag(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    const control = (event.target as HTMLElement).closest("[data-no-drag],button,input,select,textarea,a");
    if (!canEdit || dragRef.current || panRef.current || event.button !== 0 || !event.currentTarget.contains(event.target as Node) || (control && event.currentTarget.contains(control))) return;
    event.stopPropagation();
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, start: { x: event.clientX, y: event.clientY }, element: event.currentTarget, pointerId: event.pointerId, moved: false };
  }

  function moveNode(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
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
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
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
    if (panRef.current || dragRef.current || !canPanFlowCanvas(event.currentTarget, event.target as Element, event.button)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClickRef.current = false;
    panRef.current = { start: { x: event.clientX, y: event.clientY }, origin: pan, pointerId: event.pointerId, moved: false };
    setPanning(true);
  }

  function movePan(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current) return moveNode(event);
    const active = panRef.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) >= 5) active.moved = true;
    setPan({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y });
  }

  function endPan(event: ReactPointerEvent<HTMLElement>, cancelled = false) {
    if (dragRef.current) return endNodeDrag(event, cancelled);
    const gesture = panRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressClickRef.current = gesture.moved;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    setPanning(false);
  }

  function lostPointerCapture(event: ReactPointerEvent<HTMLElement>) {
    if (panRef.current?.pointerId === event.pointerId && event.target === event.currentTarget) endPan(event, true);
    if (dragRef.current?.pointerId === event.pointerId && event.target === dragRef.current.element) endNodeDrag(event, true);
  }

  function moveCanvasWithWheel(event: ReactWheelEvent<HTMLElement>) {
    if (!canHandleFlowCanvasWheel(event.currentTarget, event.target as Element)) return;
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
    const elements = document.elementsFromPoint(client.x, client.y);
    if (elements.some(element => element.closest('.wf-panel, .wf-topbar, .wf-mobile-tabs, .wf-context-bar, [aria-label="Journey preview"]'))) return null;
    const hit = elements.find((element) => viewport.contains(element));
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
  const { x: mapLeft, y: mapTop, width: mapWidth, height: mapHeight } = flowMinimapBounds(minimap.nodes);
  const mapViewport = { x: ((visibleArea?.x ?? 0) - pan.x) / zoom, y: ((visibleArea?.y ?? 0) - pan.y) / zoom, width: (visibleArea?.width ?? 800) / zoom, height: (visibleArea?.height ?? 600) / zoom };


  useImperativeHandle(navigationRef, () => ({ focusAction }));
  // Clipping prevents focus changes from scrolling the canvas behind its pan transform.
  return <main data-flow-dragging={active?.data.current?.flowStepType || dragPreview ? "" : undefined} style={{ "--wf-node-width": `${nodeWidth}px`, "--wf-node-gap": `${FLOW_NODE_GAP}px` } as CSSProperties} ref={setViewportRef} aria-label="Workflow canvas. Drag the background or scroll to pan. Drag actions to reorder the workflow." onWheel={moveCanvasWithWheel} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={(event) => endPan(event, true)} onLostPointerCapture={lostPointerCapture} onClickCapture={(event) => { if (suppressClickRef.current) { event.stopPropagation(); suppressClickRef.current = false; } }} className={`wf-canvas touch-none overflow-clip select-none ${panning ? "cursor-grabbing" : "cursor-grab"}`}>
    <div ref={contentRef} className="absolute left-0 top-0 h-[2400px] w-[2400px] origin-top-left" style={{ visibility: layoutReady ? "visible" : "hidden", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {connectorNodes.map(({ from, to }) => <FlowConnector key={from.id} state={health.actions?.[to.id]?.state ?? health.connectionState} actionId={to.id} from={{ x: from.x + from.width / 2, y: from.y + from.height }} to={{ x: to.x + to.width / 2, y: to.y }} />)}
      </svg>
      {connectorNodes.map(({ from, to, insertAt: position }) => <div key={`add-${position}`} data-canvas-node data-flow-insert-at={position} data-flow-drop-indicator={paletteDropIndex === position ? "" : undefined} className={`absolute ${insertAt === position ? "z-40" : "z-20"}`} style={{ left: from.x + from.width / 2 - 16, top: (from.y + from.height + to.y) / 2 - 16 }}>
        <FlowActionPicker items={actionChoices} context="Main sequence" label={`Add action at position ${position + 1}`} disabled={!canEdit} open={insertAt === position} onOpenChange={(open) => setInsertAt(open ? position : null)} onAdd={(type) => onAddStep(type, position)} />
      </div>)}
      <div data-canvas-node data-flow-node-id={triggerId} className="absolute" style={{ left: triggerPosition.x, top: triggerPosition.y, width: nodeWidth }}><button type="button" className="wf-trigger-card" aria-pressed={selection === "trigger"} onClick={() => setSelection("trigger")}><span className="wf-trigger-main"><span className="wf-trigger-label"><Zap />Trigger</span><strong>When {formatTrigger(draft.triggerType, draft.triggerConfig)}</strong><UserRoundCheck className="wf-trigger-person" /></span>{triggerProfileSummary(draft).length ? <span className="wf-trigger-filter-footer"><Badge variant="secondary">Profile filters · {triggerProfileSummary(draft).length}</Badge></span> : null}</button></div>
      {draft.steps.map((step, index) => {
        const id = step.id || `step-${index}`;
        const dragging = dragPreview?.id === id;
        const position = stepPositions[index]!;
        return <div key={id} data-canvas-node data-flow-node-id={id} data-flow-action-id={id} className={`absolute ${dragging ? "opacity-40" : ""}`} style={{ left: position.x, top: position.y, width: nodeWidth }}>
          <FlowNode health={health} nodeWidth={nodeWidth} step={step} index={index} selected={selection === step.id} onSelect={() => setSelection(step.id!)} selection={selection} onSelectAction={setSelection} onSplitChange={(config) => onUpdateStep(index, config)} preview={preview} onPointerDown={(event) => startNodeDrag(event, id)} dropTarget={dropTarget} onActionPointerDown={startNodeDrag} onInsertAction={(type, target) => onDropFlowAction({ type }, target)} onMove={(offset) => { setInsertAt(null); onMoveStep(index, offset); }} onRemove={() => { setInsertAt(null); onRemoveStep(index); }} disabled={!canEdit} last={index === draft.steps.length - 1} />
        </div>;
      })}
      <div data-canvas-node data-flow-node-id={endId} className="absolute" style={{ left: endPosition.x, top: endPosition.y, width: endPosition.width }}><div className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm"><CheckCircle2 className="mr-1 inline size-4" />End of workflow</div></div>
    </div>
    {dragPreview ? <div className="pointer-events-none fixed z-[80] rounded-xl border border-primary bg-background px-4 py-3 text-sm font-semibold shadow-xl" style={{ left: dragPreview.position.x + 14, top: dragPreview.position.y + 14 }}>{stepLabels[flowActionLocations(draft.steps).find(({ action }) => action.id === dragPreview.id)!.action.type]}</div> : null}
    <div data-canvas-controls className="wf-canvas-tools" role="group" aria-label="Canvas zoom controls">
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => changeZoom(zoom - 0.1)} aria-label="Zoom out"><Minus /></Button>
      <span translate="no" data-no-translate>{zoom < 0.01 ? "<1" : Math.round(zoom * 100)}%</span>
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => changeZoom(zoom + 0.1)} aria-label="Zoom in"><Plus /></Button>
      <span className="wf-tool-divider" />
      <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Canvas options" />}><MoreVertical /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={fitView}><Maximize2 />Fit workflow to canvas</DropdownMenuItem><DropdownMenuItem onClick={() => changeZoom(1)}>Actual size</DropdownMenuItem></DropdownMenuContent></DropdownMenu><FlowOutline compact steps={draft.steps} selection={selection} onFocus={focusAction} />
    </div>
    <button type="button" data-canvas-controls className="wf-minimap" aria-label="Workflow minimap. Click to navigate or press Enter to fit the workflow." onClick={event => {
      if (event.detail === 0) { fitView(); return; }
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = event.currentTarget.querySelector("svg")!.getBoundingClientRect(), area = flowCanvasArea(viewport);
      const point = { x: mapLeft + (event.clientX - rect.left) / rect.width * mapWidth, y: mapTop + (event.clientY - rect.top) / rect.height * mapHeight };
      setPan({ x: area.x + area.width / 2 - point.x * zoom, y: area.y + area.height / 2 - point.y * zoom });
    }}><svg aria-hidden="true" viewBox={`${mapLeft} ${mapTop} ${mapWidth} ${mapHeight}`} preserveAspectRatio="none">
      {minimap.connectors.map((connector, index) => <path key={index} d={connector.path} transform={`translate(${connector.x} ${connector.y})`} className="wf-minimap-connector" />)}
      {minimap.nodes.map(node => <rect key={node.id} data-flow-minimap-id={node.id} data-minimap-kind={node.kind} data-selected={node.id === selection || (node.kind === "trigger" && selection === "trigger") ? "" : undefined} x={node.x} y={node.y} width={node.width} height={node.height} rx="10" className="wf-minimap-node" />)}
      <rect x={mapViewport.x} y={mapViewport.y} width={mapViewport.width} height={mapViewport.height} className="wf-minimap-viewport" />
    </svg></button>
  </main>;
}

export function FlowBuilder({ liveSendingEnabled = true, initialFlows, mailboxOptions, memberOptions, initialFlowId, canEdit: canCreate, viewerId, viewerEmail, isAdmin = false, filterOptions, initialDraft, initialCreate = false, initialCollectionView = "list", scopedContext }: { liveSendingEnabled?: boolean; initialFlows: AutomationFlow[]; mailboxOptions: FlowMailboxOption[]; memberOptions: Option[]; initialFlowId?: string; canEdit: boolean; viewerId: string; viewerEmail?: string | null; isAdmin?: boolean; filterOptions: FilterOptions; initialDraft?: FlowInput; initialCreate?: boolean; initialCollectionView?: FlowCollectionView; scopedContext?: { config: JsonConfig; refreshUrl: string; returnHref: string } }) {
  const { t } = useLanguage();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [flows, setFlows] = useState(initialFlows);
  const [collectionView, setCollectionView] = useState<FlowCollectionView>(initialCollectionView);
  const flowsRef = useRef(flows);
  useEffect(() => { flowsRef.current = flows; }, [flows]);
  const [deletingFlow, setDeletingFlow] = useState<AutomationFlow | null>(null);
  const actionBusy = useRef(false);
  const initial = initialFlowId === "default" ? initialFlows.find((flow) => flow.name === "3-step follow-up" && flow.createdBy === viewerId) : initialFlows.find((flow) => flow.id === initialFlowId);
  const [draft, setDraftState] = useState<DraftFlow | null>(initial ? toDraft(initial) : initialDraft ? { ...initialDraft, id: null } : null);
  const latestDraft = useRef(draft);
  function setDraft(value: DraftFlow | null | ((current: DraftFlow | null) => DraftFlow | null)) {
    const next = typeof value === "function" ? value(latestDraft.current) : value;
    latestDraft.current = next; setDraftState(next);
  }
  const [view, setView] = useState<"list" | "builder">(initial || initialDraft ? "builder" : "list");
  const [selection, setSelectionState] = useState<Selection>("trigger");
  const latestSelection = useRef(selection);
  function updateSelection(value: Selection) { latestSelection.current = value; setSelectionState(value); }
  const [inspectorTab, setInspectorTab] = useState("configure");
  const [editorPanel, setEditorPanel] = useState<"actions" | "settings" | "hidden">(initialDraft ? "settings" : "actions");
  const [mobileBuilderPanel, setMobileBuilderPanel] = useState<"canvas" | "settings">("canvas");
  const setSelection = (value: Selection) => {
    if (value === selection && editorPanel === "settings" && inspectorTab === "configure") return;
    switchAction(current => activateSelection(value, current));
  };
  const [panelSnapshot, setPanelSnapshot] = useState<FlowEditorSnapshot | null>(() => initialDraft ? flowEditorSnapshot(initialDraft, "trigger") : null);
  const pendingEditor = useRef<FlowPanelEditor | null>(null);
  const [localPanelDirty, setLocalPanelDirty] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const pendingNavigation = useRef<((flow: DraftFlow) => void) | null>(null);
  const discardWholeFlow = useRef(false);
  const [panelSaveError, setPanelSaveError] = useState("");
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const saveInProgress = useRef(false);
  const editorIdentity = useRef<{ id: string | null }>({ id: initial?.id ?? null });
  const editorWriteQueue = useRef<Promise<unknown>>(Promise.resolve());
  const autoSavePending = useRef(0);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [emailTestOpen, setEmailTestOpen] = useState(false);
  const [deliveryTestRequested, setDeliveryTestRequested] = useState(false);
  const [quickCheckOpen, setQuickCheckOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<Record<string, string[]>>({});
  const [alertDraftVersion, setAlertDraftVersion] = useState(0);
  const alertsPanelId = useId();
  const alertsBellRef = useRef<HTMLButtonElement | null>(null);
  const canvasNavigation = useRef<{ focusAction: (id: string) => void } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<FlowPreviewResult | null>(null);
  const [emailTestPath, setEmailTestPath] = useState<number[] | undefined>(undefined);
  const [scenarioLabOpen, setScenarioLabOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(initialCreate && canCreate && !scopedContext);
  const [auditOpen, setAuditDialogOpen] = useState(false);
  const [launchReviewOpen, setLaunchReviewOpen] = useState(false);
  const canManageFlow = (flow: AutomationFlow) => canCreate && (isAdmin || flow.createdBy === viewerId);
  const canEdit = canCreate && (!draft?.id || flows.some((flow) => flow.id === draft.id && canManageFlow(flow)));
  const savedFlow = flows.find(flow => flow.id === draft?.id);
  const hasUnsavedChanges = Boolean(draft && (!savedFlow || !flowEditorEqual(draft, toDraft(savedFlow))));
  const hasPanelChanges = Boolean(draft && panelSnapshot && flowEditorChanged(draft, panelSnapshot)) || localPanelDirty;
  const connectorHealth = useFlowConnectorHealth(view === "builder" ? draft : null, draft?.id ?? null, savedFlow?.dependencyIssue || savedFlow?.editorDraft?.publicationError, !hasUnsavedChanges && !savedFlow?.editorDraft);

  useEffect(() => {
    if (view !== "builder" || (!hasUnsavedChanges && !hasPanelChanges)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [view, hasUnsavedChanges, hasPanelChanges]);

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
  const mailboxes = useMemo(() => flowSenderOptions(mailboxOptions, senderOwnerId, viewerId), [mailboxOptions, senderOwnerId, viewerId]);
  const palette = stepTypes.filter(type => type !== "if_condition");
  const selectedLocation = draft ? flowActionLocations(draft.steps).find((item) => item.action.id === selection) : undefined;
  const selectedIndex = selectedLocation?.path[0] ?? -1;
  const selectedMessagePath = selectedLocation?.path ?? [selectedIndex];
  const auditFindings = draft ? auditFlowDefinition(draft) : [];
  if (!liveSendingEnabled && draft && flowActionLocations(draft.steps).some(({ action }) => action.type === "send_email" || action.type === "ai_auto_reply" || action.type === "internal_alert" && action.config.channel === "email")) {
    auditFindings.push({ id: "live-sending", severity: "error", label: "Email delivery is temporarily unavailable. Your workflow can be saved as a draft. Please try again later or contact support." });
  }
  const auditCanLaunch = auditFindings.every((finding) => finding.severity !== "error");
  const alertScope = `${viewerId}:${draft?.id ?? `new:${alertDraftVersion}`}`;
  const workflowAlerts = draft ? flowAlerts(draft, connectorHealth, auditFindings) : [];
  const alertLists = partitionFlowAlerts(workflowAlerts, dismissedAlerts[alertScope] ?? []);

  function closeAlerts() { setAlertsOpen(false); alertsBellRef.current?.focus(); }
  function reviewAlert(alert: FlowAlert) {
    const actionId = alert.target === "trigger" ? "trigger" : alert.actionId;
    const focus = () => {
      if (actionId) { setPreviewOpen(false); setPreviewResult(null); setMobileBuilderPanel("settings"); }
      if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 760px)").matches) {
        setAlertsOpen(false);
        if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => alertsBellRef.current?.closest(".workflow-editor")?.querySelector<HTMLElement>('.wf-inspector input:not([disabled]), .wf-inspector textarea:not([disabled]), .wf-inspector button:not([disabled])')?.focus({ preventScroll: true }));
        return;
      }
      if (actionId && typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => canvasNavigation.current?.focusAction(actionId));
    };
    if (actionId === selection && editorPanel === "settings" && inspectorTab === "configure") { focus(); return; }
    requestNavigation(current => {
      if (actionId) { activateSelection(actionId, current); focus(); }
      else if (alert.target === "workflow") {
        pendingEditor.current = null; setPanelSnapshot(null); setLocalPanelDirty(false); setEditorPanel("actions");
        if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => alertsBellRef.current?.closest(".workflow-editor")?.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.focus());
      } else if (alert.target === "checks" && flowInputSchema.safeParse(current).success) setQuickCheckOpen(true);
      else void setAuditOpen(true);
    });
  }

  function activateSelection(value: Selection, current: DraftFlow, before = current) {
    pendingEditor.current = null;
    setLocalPanelDirty(false); setPanelSaveError("");
    setPanelSnapshot(flowEditorSnapshot(before, value));
    updateSelection(value); setInspectorTab("configure"); setEditorPanel("settings"); setMobileBuilderPanel("settings");
  }
  function requestNavigation(go: (flow: DraftFlow) => void, wholeFlow = false) {
    if (!draft || saveInProgress.current) return;
    const dirty = hasPanelChanges || pendingEditor.current?.hasChanges() || wholeFlow && hasUnsavedChanges;
    if (dirty) { pendingNavigation.current = go; discardWholeFlow.current = wholeFlow; setPanelSaveError(""); setLeaveDialogOpen(true); }
    else go(draft);
  }
  function switchAction(go: (flow: DraftFlow) => void, save = true) {
    if (!draft || saveInProgress.current) return;
    const changed = hasPanelChanges || pendingEditor.current?.hasChanges();
    let current = draft;
    if (changed && canEdit) {
      const pending = pendingEditor.current?.snapshot?.();
      if (pending?.trigger) current = { ...current, ...pending.trigger };
      if (pending?.config && selectedLocation) current = { ...current, steps: editFlowSiblings(current.steps, selectedLocation.path, (steps, index) => steps.map((step, i) => i === index ? { ...step, config: pending.config! } : step)) };
      setDraft(current);
    }
    go(current);
    if (changed && canEdit && save) void saveEditingCopy(current);
  }
  function finishNavigation(current: DraftFlow) {
    const go = pendingNavigation.current;
    pendingNavigation.current = null; setLeaveDialogOpen(false); setPanelSaveError("");
    go?.(current);
  }
  function discardPanelChanges() {
    if (!draft || saveInProgress.current) return;
    const current = discardWholeFlow.current && savedFlow ? toDraft(savedFlow) : panelSnapshot ? restoreFlowEditor(draft, panelSnapshot) : draft;
    pendingEditor.current?.reset(); pendingEditor.current = null;
    setDraft(current); setLocalPanelDirty(false); setEditorVersion(version => version + 1);
    setPanelSnapshot(flowEditorSnapshot(current, selection));
    finishNavigation(current);
  }
  function closeSettings() {
    requestNavigation(() => { pendingEditor.current = null; setLocalPanelDirty(false); setPanelSnapshot(null); setEditorPanel("actions"); setMobileBuilderPanel("canvas"); });
  }
  function preparedDraft(current: DraftFlow): DraftFlow | null {
    if (editorPanel !== "settings" || inspectorTab !== "configure") return current;
    const pending = pendingEditor.current?.prepare();
    if (pending && !pending.ok) { setPanelSaveError("Complete the highlighted settings before saving."); return null; }
    if (!pending?.ok) return current;
    if (pending.trigger) return { ...current, ...pending.trigger };
    const location = flowActionLocations(current.steps).find(item => item.action.id === selection);
    return pending.config && location ? { ...current, steps: editFlowSiblings(current.steps, location.path, (steps, index) => steps.map((step, i) => i === index ? { ...step, config: pending.config! } : step)) } : current;
  }
  async function saveTextEmailContent(config: JsonConfig) {
    if (!draft || !selectedLocation || !canEdit || saveInProgress.current) return false;
    const current = { ...draft, steps: editFlowSiblings(draft.steps, selectedLocation.path, (steps, index) => steps.map((step, i) => i === index ? { ...step, config } : step)) };
    setDraft(current);
    const saved = await saveEditingCopy(current);
    if (!saved) return false;
    const path = selectedLocation.path.join(".");
    const nextSelection = flowActionLocations(saved.steps).find(item => item.path.join(".") === path)?.action.id || "trigger";
    setDraft(saved); updateSelection(nextSelection); setPanelSnapshot(flowEditorSnapshot(saved, nextSelection)); setLocalPanelDirty(false); setEditorVersion(value => value + 1); setPanelSaveError("");
    return true;
  }
  async function savePanel(continueNavigation = false) {
    const saved = await persist();
    if (!saved) return;
    if (continueNavigation) finishNavigation(saved);
    else if (selectedLocation?.action.type !== "send_email") { pendingEditor.current = null; setPanelSnapshot(null); setLocalPanelDirty(false); setEditorPanel("actions"); setMobileBuilderPanel("canvas"); }
  }
  function openFlow(flow: AutomationFlow) {
    const open = () => { editorIdentity.current = { id: flow.id }; setAutoSaving(false); setAutoSaveFailed(false); pendingEditor.current = null; setLocalPanelDirty(false); setPanelSnapshot(null); setDraft(toDraft(flow)); updateSelection("trigger"); setEditorPanel("actions"); setMobileBuilderPanel("canvas"); setView("builder"); setErrors({}); setNotice(""); };
    if (view === "builder" && draft) requestNavigation(open, true); else open();
  }
  function createScopedFlow() {
    editorIdentity.current = { id: null }; setAutoSaveFailed(false);
    const created: DraftFlow = initialDraft ? { ...initialDraft, id: null, triggerConfig: { ...initialDraft.triggerConfig }, steps: initialDraft.steps.map(step => ({ ...step, id: crypto.randomUUID(), config: { ...step.config } })) } : newDraft();
    setDraft(created); activateSelection("trigger", created); setAlertDraftVersion(version => version + 1); setView("builder"); setErrors({}); setNotice("");
  }
  function chooseStarter(flow: FlowInput) {
    editorIdentity.current = { id: null }; setAutoSaveFailed(false);
    const created = { ...flow, id: null };
    setDraft(created); activateSelection("trigger", created); setAlertDraftVersion(version => version + 1);
    setView("builder"); setErrors({}); setNotice(""); setStarterOpen(false);
  }
  function updateStep(index: number, config: JsonConfig) { if (!draft) return; setDraft({ ...draft, steps: draft.steps.map((step, i) => i === index ? { ...step, config } : step) }); }
  function updateSelectedStep(config: JsonConfig) {
    if (!draft || !selectedLocation) return;
    setDraft({ ...draft, steps: editFlowSiblings(draft.steps, selectedLocation.path, (steps, index) => steps.map((step, i) => i === index ? { ...step, config } : step)) });
  }
  function changeEmailStatus(actionId: string, emailStatus: FlowStatus) {
    if (!canEdit || saving || autoSaving) return;
    switchAction(current => {
      const location = flowActionLocations(current.steps).find(item => item.action.id === actionId && item.action.type === "send_email");
      if (!location) return;
      const next = { ...current, steps: editFlowSiblings(current.steps, location.path, (steps, index) => steps.map((step, i) => i === index ? { ...step, config: { ...step.config, emailStatus } } : step)) };
      setDraft(next);
      if (selection === actionId) setEditorVersion(version => version + 1);
      void saveEditingCopy(next);
    }, false);
  }
  function rememberFlow(flow: AutomationFlow) {
    const next = flowsRef.current.some(item => item.id === flow.id) ? flowsRef.current.map(item => item.id === flow.id ? flow : item) : [flow, ...flowsRef.current];
    flowsRef.current = next; setFlows(next);
  }
  async function saveEditingCopy(source: DraftFlow): Promise<DraftFlow | null> {
    const identity = editorIdentity.current;
    identity.id ??= source.id ?? blankStep("stop").id!;
    const flowId = identity.id;
    autoSavePending.current++; setAutoSaving(true); setAutoSaveFailed(false);
    const operation = editorWriteQueue.current.then(async () => {
      try {
        const known = flowsRef.current.find(item => item.id === flowId);
        const { name, triggerType, triggerConfig, status, steps } = source;
        const response = await fetch("/api/flows/editor-draft", { method: "POST", headers: { "Content-Type": "application/json" }, signal: typeof AbortSignal === "undefined" ? undefined : AbortSignal.timeout(15_000),
          body: JSON.stringify({ flowId, create: !known && !source.id, revision: known ? known.editorDraft?.revision ?? 0 : source.editorRevision ?? 0, baseUpdatedAt: known?.updatedAt ?? source.updatedAt ?? null, flow: { name, triggerType, triggerConfig, status, steps } }) });
        const result = await response.json().catch(() => ({ ok: false, error: "Unable to save changes automatically." }));
        if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save changes automatically.");
        const saved = toDraft(result.flow); rememberFlow(result.flow);
        if (editorIdentity.current === identity) {
          const definition = ({ name, triggerType, triggerConfig, status, steps }: DraftFlow) => ({ name, triggerType, triggerConfig, status, steps });
          const latest = latestDraft.current;
          if (latest && flowEditorEqual(definition(latest), definition(source)) && !pendingEditor.current?.hasChanges()) {
            const selectedPath = flowActionLocations(source.steps).find(item => item.action.id === latestSelection.current)?.path.join(".");
            const selectedId = latestSelection.current === "trigger" ? "trigger" : flowActionLocations(saved.steps).find(item => item.path.join(".") === selectedPath)?.action.id || latestSelection.current;
            setDraft(saved); updateSelection(selectedId);
            setPanelSnapshot(baseline => baseline ? flowEditorSnapshot(saved, selectedId) : baseline);
          } else if (latest) {
            setDraft({ ...saved, name: latest.name, triggerType: latest.triggerType, triggerConfig: latest.triggerConfig, steps: latest.steps });
          }
          if (!source.id && typeof window !== "undefined" && window.location?.href) {
            const url = new URL(window.location.href);
            url.searchParams.set("flow", saved.id!);
            for (const key of ["create", "segmentId", "segment"]) url.searchParams.delete(key);
            window.history.replaceState(null, "", url.pathname + url.search + url.hash);
          }
          setAutoSaveFailed(Boolean(result.flow.editorDraft?.publicationError));
          if (result.flow.editorDraft?.publicationError) setNotice(result.flow.editorDraft.publicationError);
        }
        return saved;
      } catch (cause) {
        if (editorIdentity.current === identity) { setAutoSaveFailed(true); setNotice(cause instanceof Error ? cause.message : "Unable to save changes automatically."); }
        return null;
      } finally { autoSavePending.current--; if (editorIdentity.current === identity && !autoSavePending.current) setAutoSaving(false); }
    });
    editorWriteQueue.current = operation;
    return operation;
  }
  function moveStep(index: number, offset: number) { if (!draft) return; const target = index + offset; if (target < 0 || target >= draft.steps.length) return; setDraft({ ...draft, steps: reorderFlowSteps(draft.steps, index, target) }); }
  function dropAction(input: FlowDragInput, target: FlowDropTarget) {
    if (!draft || !canEdit) return;
    let added: ReturnType<typeof dropFlowAction>["action"] = undefined;
    switchAction(current => {
      const result = dropFlowAction(current.steps, target, "type" in input ? { action: blankStep(input.type) } : input);
      if (result.error) { toast.error(t(result.error)); return; }
      const next = { ...current, steps: result.steps };
      setDraft(next);
      if (result.action?.id) activateSelection(result.action.id, next);
      void saveEditingCopy(next);
      setInsertAt(null); added = result.action;
    }, false);
    return added ?? null;
  }
  function addStep(type: FlowStepType, position = draft?.steps.length ?? 0) { return dropAction({ type }, { branchId: null, index: position }) ?? null; }
  function removeStep(index: number) { requestNavigation(current => { const steps = current.steps.filter((_, i) => i !== index); const next = { ...current, steps }; setDraft(next); activateSelection(steps[Math.min(index, steps.length - 1)]?.id || "trigger", next); }); }

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

  async function persist(status: FlowStatus = draft?.status ?? "draft"): Promise<DraftFlow | null> {
    if (!draft || !canEdit || saveInProgress.current || autoSavePending.current) return null;
    const current = preparedDraft(draft);
    if (!current) return null;
    const payload = { name: current.name, triggerType: current.triggerType, triggerConfig: current.triggerConfig, status, steps: current.steps };
    const parsed = flowInputSchema.safeParse(payload);
    if (!parsed.success && status === current.status) {
      const action = flowActionLocations(current.steps).find(item => item.action.id === selection)?.action;
      if (selection === "trigger" || action && !flowActionConfigIssue(action.type, action.config)) {
        saveInProgress.current = true; setSaving(true);
        try { const saved = await saveEditingCopy(current); if (saved) { setDraft(saved); setPanelSnapshot(flowEditorSnapshot(saved, selection)); setLocalPanelDirty(false); setEditorVersion(version => version + 1); setPanelSaveError(""); setNotice("All changes saved."); } return saved; }
        finally { saveInProgress.current = false; setSaving(false); }
      }
    }
    if (!parsed.success) { const next: Record<string, string> = {}; parsed.error.issues.forEach((issue) => { const key = issue.path[0] === "steps" ? `step-${String(issue.path[1])}` : String(issue.path[0] || "form"); next[key] ||= issue.message; }); setErrors(next); const message = parsed.error.issues[0]?.message || "Complete the highlighted settings before saving."; setNotice(message); setPanelSaveError(message); return null; }
    saveInProgress.current = true; setSaving(true); setErrors({}); setNotice(""); setPanelSaveError("");
    try {
      const response = await fetch(current.id ? `/api/flows/${current.id}` : "/api/flows", { method: current.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json().catch(() => ({ ok: false, error: "The server returned an invalid response." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save workflow.");
      const flow = result.flow as AutomationFlow, saved = toDraft(flow);
      const path = selectedLocation?.path.join(".");
      const selectedId = selection === "trigger" ? "trigger" : flowActionLocations(flow.steps).find(item => item.path.join(".") === path)?.action.id || "trigger";
      rememberFlow(flow); editorIdentity.current.id = flow.id;
      setDraft(saved); updateSelection(selectedId); setPanelSnapshot(flowEditorSnapshot(saved, selectedId)); setLocalPanelDirty(false); setEditorVersion(version => version + 1);
      const statusChanged = status !== current.status;
      setNotice(statusChanged ? status === "live" ? "Workflow is live." : "Workflow paused." : "All changes saved.");
      toast.success(statusChanged ? status === "live" ? "Automation turned on" : "Automation paused" : "Workflow saved");
      return saved;
    } catch (error) { const message = error instanceof Error ? error.message : "Unable to save workflow."; setNotice(message); setPanelSaveError(message); return null; }
    finally { saveInProgress.current = false; setSaving(false); }
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

  if (view === "list" || !draft) return <><FlowListView collectionView={collectionView} onViewChange={setCollectionView} flows={flows} canEdit={canCreate} viewerId={viewerId} isAdmin={isAdmin} memberOptions={memberOptions} scopedContext={scopedContext} onBulkAction={runBulkAction} onCreate={() => { if (!scopedContext) { setStarterOpen(true); return; } createScopedFlow(); }} onOpen={openFlow} onDuplicate={duplicateFlow} onChangeStatus={changeStatus} onRemove={async (flow) => { setDeletingFlow(flow); }} />{starterOpen ? <Suspense fallback={null}><LazyStarterDialog viewerId={viewerId} onOpenChange={setStarterOpen} onChoose={chooseStarter} /></Suspense> : null}<ConfirmActionDialog open={Boolean(deletingFlow)} onOpenChange={(open) => { if (!open) setDeletingFlow(null); }} title="Delete workflow?" description={`Delete “${deletingFlow?.name ?? ""}” and its run history? This cannot be undone.`} onConfirm={async () => { if (deletingFlow) await removeFlow(deletingFlow); }} /></>;

  const selectedStep = selectedLocation?.action;
  const selectedSender = selectedStep ? visibleFlowSender(mailboxOptions, senderOwnerId, viewerId, selectedStep.config.mailboxId) : null;
  const savedEmailIds = savedFlow ? flowActionLocations(savedFlow.steps).filter(item => item.action.type === "send_email").map(item => item.action.id!) : [];
  const selectedTrail = selectedLocation ? flowActionTrail(draft.steps, selectedLocation.path) : [];
  const InspectorIcon = inspectorTab === "insights" ? History : selectedStep ? stepMeta[selectedStep.type].icon : Zap;
  const settingsFooter = <>{autoSaveFailed ? <p role="alert" className="wf-save-error">Changes could not be saved automatically. <button type="button" className="underline" onClick={() => void saveEditingCopy(draft)}>Retry</button></p> : panelSaveError ? <p role="alert" className="wf-save-error">{panelSaveError}</p> : null}<FlowPanelSaveControls cancelLabel={selectedStep?.type === "send_email" ? "Cancel" : undefined} dirty={hasPanelChanges || hasUnsavedChanges} saving={saving} autoSaving={autoSaving} disabled={!canEdit} onSave={() => void savePanel()} onCancel={closeSettings} /></>;
  return <FlowEmailPerformanceProvider flowId={draft.id} version={savedFlow?.updatedAt} status={draft.status} savedIds={savedEmailIds} emailNames={Object.fromEntries(flowActionLocations(draft.steps).filter(item => item.action.type === "send_email").map((item, index) => [item.action.id!, `Email #${index + 1}`]))} disabled={!canEdit || saving || autoSaving} onEmailStatusChange={changeEmailStatus}><div data-ai-flow-id={draft.id} data-ai-flow-draft={JSON.stringify({ name: draft.name, triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, status: draft.status, steps: draft.steps })} data-ai-flow-unsaved={hasUnsavedChanges} data-ai-flow-step-id={selection} data-flow-health={connectorHealth.state} className="workflow-editor">
    <header className="wf-topbar">
      <div className="wf-breadcrumb">
        <Button type="button" variant="ghost" size="sm" aria-label={scopedContext ? "Back to email" : "Back to workflows"} onClick={() => requestNavigation(() => { if (scopedContext) window.location.assign(scopedContext.returnHref); else setView("list"); }, true)}>{scopedContext ? "Email" : "Flows"}</Button><span aria-hidden="true">/</span>
        <div className="wf-name-field"><span aria-hidden="true">{draft.name || "Untitled workflow"}</span><Input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} aria-label="Workflow name" disabled={!canEdit || saving || previewOpen} /></div>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Switch workflow" />}><ChevronDown /></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-80 max-w-96 overflow-y-auto">{flows.map(flow => <DropdownMenuItem key={flow.id} onClick={() => openFlow(flow)}><span className="truncate">{flow.name}</span>{flow.id === draft.id ? <Check className="ml-auto" /> : null}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
        <Badge variant={statusVariant(draft.status)} className="capitalize">{draft.status}</Badge>
        {!hasUnsavedChanges && !savedFlow?.editorDraft && connectorHealth.state !== "idle" ? <span className="wf-health-status" data-health={connectorHealth.state} role="status" title={connectorHealth.message} aria-label={connectorHealth.message}>{connectorHealth.state === "error" ? "Needs attention" : connectorHealth.state === "live" ? "Healthy" : "Health unverified"}</span> : null}
      </div>
      <div className="wf-toolbar-actions">
        <span className="sr-only" role="status">{hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}</span>
        {previewOpen ? <Button variant="outline" size="sm" onClick={() => { setPreviewOpen(false); setPreviewResult(null); setEditorPanel("actions"); }}>Exit preview</Button> : <>
          <div className="wf-toolbar-tools"><DropdownMenu><DropdownMenuTrigger render={<Button className="wf-icon-button" variant="ghost" size="icon-sm" aria-label="Workflow options" />}><MoreVertical /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setQuickCheckOpen(true)}><CheckCircle2 />Quick test</DropdownMenuItem><DropdownMenuItem onClick={() => setScenarioLabOpen(true)}><ListFilter />Simulate scenarios</DropdownMenuItem><DropdownMenuItem onClick={() => { setEmailTestPath(undefined); setEmailTestOpen(true); }} disabled={!canCreate}><Mail />Test with emails</DropdownMenuItem><DropdownMenuItem onClick={() => requestNavigation(() => { setPanelSnapshot(null); setEditorPanel("actions"); setMobileBuilderPanel("settings"); })}><PanelLeft />Actions panel</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <Button className="wf-icon-button" variant="ghost" size="icon-sm" aria-label="Workflow analytics" onClick={() => requestNavigation(() => { setInspectorTab("insights"); setEditorPanel("settings"); setMobileBuilderPanel("settings"); })}><ChartNoAxesCombined /></Button>
          <Button className="wf-icon-button" variant="ghost" size="icon-sm" aria-label="Workflow run history" onClick={() => requestNavigation(() => { setInspectorTab("insights"); setEditorPanel("settings"); setMobileBuilderPanel("settings"); })}><History /></Button>
          <FlowAlertsBell count={alertLists.active.length} open={alertsOpen} panelId={alertsPanelId} buttonRef={alertsBellRef} onToggle={() => setAlertsOpen(open => !open)} />
          <Button className="wf-icon-button" variant="ghost" size="icon-sm" aria-label="Preview workflow" onClick={() => requestNavigation(() => { setPreviewOpen(true); setPreviewResult(null); setInsertAt(null); setMobileBuilderPanel("settings"); })}><Eye /></Button>
          <Button className="wf-icon-button" variant="ghost" size="icon-sm" aria-label={saving ? "Saving workflow" : "Save workflow"} title={hasUnsavedChanges ? "Save changes" : "All changes saved"} onClick={() => void persist(draft.status)} disabled={!canEdit || saving || autoSaving}><Save /></Button>
          </div><div className="wf-toolbar-commands"><Button variant="secondary" size="sm" className="wf-text-button wf-audit-button" onClick={() => void setAuditOpen(true)} disabled={!canEdit}><AiIcon />Audit flow</Button>
          {draft.status === "live" ? <Button className="wf-text-button wf-pause-button" size="sm" variant="secondary" onClick={() => void persist("paused")} disabled={!canEdit || saving || autoSaving}><Pause />Pause</Button> : <Button className="wf-text-button wf-launch-button" size="sm" onClick={() => setLaunchReviewOpen(true)} disabled={!canEdit || saving || autoSaving}>Review and turn on</Button>}
          </div>
        </>}
      </div>
    </header>
    {scopedContext ? <div className="wf-context-bar"><span className="min-w-0 flex-1 truncate">{String(scopedContext.config.scopeLabel)}</span><Button size="sm" variant="ghost" onClick={() => requestNavigation(() => setView("list"), true)}>Manage email workflows</Button></div> : null}
    {!canEdit ? <NotificationToast tone="warning">{canCreate ? "Shared workflow is read-only. Its creator or an administrator can change it." : "Viewer access is read-only."}</NotificationToast> : null}
    <div className="wf-mobile-tabs" role="group" aria-label="Workflow workspace view">
      <Button variant={mobileBuilderPanel === "canvas" ? "secondary" : "ghost"} className="flex-1" aria-pressed={mobileBuilderPanel === "canvas"} onClick={() => setMobileBuilderPanel("canvas")}><Workflow />Canvas</Button>
      <Button variant={mobileBuilderPanel === "settings" ? "secondary" : "ghost"} className="flex-1" aria-pressed={mobileBuilderPanel === "settings"} onClick={() => { if (editorPanel === "hidden") setEditorPanel("actions"); setMobileBuilderPanel("settings"); }}><Settings2 />{editorPanel === "settings" ? "Settings" : "Actions"}</Button>
    </div>
    <DndContext id="flow-action-palette" sensors={sensors} collisionDetection={pointerWithin} autoScroll={false}>
    <div data-mobile-panel={mobileBuilderPanel} data-alerts-open={alertsOpen || undefined} data-editor-panel={previewOpen ? "preview" : editorPanel} className="wf-workbench">
      {!previewOpen && editorPanel === "actions" ? <FlowActionPalette
        canEdit={canEdit}
        actions={palette}
        onAdd={(type) => addStep(type, insertAt ?? draft.steps.length)}
        onClose={() => setEditorPanel("hidden")}
      /> : null}
      {previewOpen ? <FlowJourneyPreview flow={draft} flowId={draft.id} result={previewResult} onResult={setPreviewResult} onFocus={id => { setSelection(id); setMobileBuilderPanel("canvas"); }} onTestMessage={path => { setEmailTestPath(path); setEmailTestOpen(true); }} /> : editorPanel === "settings" ? selection === "trigger" && inspectorTab === "configure" ? <FlowTriggerPanel key={`trigger-${editorVersion}`} editorRef={pendingEditor} onDirtyChange={setLocalPanelDirty} onNavigate={go => requestNavigation(() => go())} footer={settingsFooter} flow={draft} onChange={flow => setDraft({ ...draft, ...flow })} disabled={!canEdit || saving || autoSaving} filterOptions={filterOptions} receivingMailboxes={mailboxOptions.filter(mailbox => mailbox.isActive && (mailbox.type === "workspace" || mailbox.userId === senderOwnerId)).map(mailbox => ({ id: mailbox.id, label: mailbox.email }))} onClose={closeSettings} onPreview={() => requestNavigation(() => { setPreviewOpen(true); setPreviewResult(null); setMobileBuilderPanel("settings"); })} /> : selectedStep?.type === "wait" && inspectorTab === "configure" ? <FlowWaitPanel key={`${selectedStep.id}-${editorVersion}`} editorRef={pendingEditor} onDirtyChange={setLocalPanelDirty} footer={settingsFooter} config={selectedStep.config} onChange={updateSelectedStep} disabled={!canEdit || saving || autoSaving} trail={selectedTrail} onClose={closeSettings} /> : selectedStep?.type === "send_email" && inspectorTab === "configure" ? <FlowEmailPanel key={`${selectedStep.id}-${editorVersion}`} actionId={selectedStep.id} onSaveText={saveTextEmailContent} trail={selectedTrail} saved={savedEmailIds.includes(selectedStep.id!)} resolveSender={choice => { const mailbox = visibleFlowSender(mailboxOptions, senderOwnerId, viewerId, choice); return mailbox ? { name: mailbox.displayName || "", email: mailbox.email } : undefined; }} sender={selectedSender ? { name: selectedSender.displayName || "", email: selectedSender.email } : undefined} onViewActivity={() => requestNavigation(() => { setInspectorTab("insights"); setEditorPanel("settings"); setMobileBuilderPanel("settings"); })} config={selectedStep.config} onChange={updateSelectedStep} onClose={closeSettings} disabled={!canEdit || saving || autoSaving} mailboxes={mailboxes} status={draft.status} defaultName={`Email #${flowActionLocations(draft.steps).filter(item => item.action.type === "send_email").findIndex(item => item.action.id === selectedStep.id) + 1}`} sessionKey={`flow:${draft.id ?? "new"}:${selectedStep.id}`} editorRef={pendingEditor} onDirtyChange={setLocalPanelDirty} footer={settingsFooter} error={errors[`step-${selectedIndex}`]} onPreview={() => { setEmailTestPath(selectedMessagePath); setEmailTestOpen(true); }} /> : <aside className="wf-panel wf-inspector" aria-label="Workflow settings">
        <div className="wf-settings-heading"><span className="wf-settings-icon"><InspectorIcon /></span><h2>{inspectorTab === "insights" ? "Workflow activity" : selection === "trigger" ? "Trigger" : selectedStep ? flowActionLabel(selectedStep.type) : "Action settings"}</h2><Button type="button" variant="ghost" size="icon-sm" aria-label="Close workflow settings" onClick={closeSettings}><X /></Button></div>
        <div className="wf-inspector-content scroll-surface">{inspectorTab === "insights" ? <FlowInsights key={draft.id} flowId={draft.id} /> : <>{selectedStep ? <>{["send_email", "ai_auto_reply"].includes(selectedStep.type) ? <Button variant="outline" size="sm" className="mb-5 w-full" onClick={() => { setEmailTestPath(selectedMessagePath); setEmailTestOpen(true); }}><Eye />Preview & test message</Button> : null}{selectedTrail.length ? <nav aria-label="Action location" className="wf-action-location"><span translate="no">{selectedTrail.join(" / ")}</span></nav> : null}<StepInspector type={selectedStep.type} config={selectedStep.config} onChange={updateSelectedStep} mailboxes={mailboxes} members={memberOptions} disabled={!canEdit || saving || autoSaving} />{errors[`step-${selectedIndex}`] ? <NotificationToast tone="error">{errors[`step-${selectedIndex}`]}</NotificationToast> : null}</> : null}</>}</div>
        {inspectorTab === "configure" ? settingsFooter : <div className="wf-settings-footer"><Button variant="outline" size="sm" onClick={closeSettings}>Close</Button></div>}
      </aside> : null}
      {!previewOpen && editorPanel === "hidden" ? <Button className="wf-show-actions" variant="outline" size="sm" onClick={() => { setEditorPanel("actions"); setMobileBuilderPanel("settings"); }}><PanelLeft />Actions</Button> : null}
      <div data-flow-canvas-safe-area className="wf-canvas-safe-area" aria-hidden="true" />
      {alertsOpen ? <FlowAlertsPanel key={alertScope} id={alertsPanelId} active={alertLists.active} dismissed={alertLists.dismissed} canEdit={canEdit} onClose={closeAlerts} onReview={reviewAlert} onDismiss={alert => setDismissedAlerts(current => ({ ...current, [alertScope]: [...new Set([...(current[alertScope] ?? []), flowAlertKey(alert)])] }))} onRestore={alert => setDismissedAlerts(current => ({ ...current, [alertScope]: (current[alertScope] ?? []).filter(key => key !== flowAlertKey(alert)) }))} /> : null}
      <FlowCanvas navigationRef={canvasNavigation} health={connectorHealth} key={draft.id || "new-flow"} draft={draft} selection={editorPanel === "settings" || previewOpen ? selection : ""} insertAt={insertAt} canEdit={canEdit && !saving && !hasPanelChanges && !previewOpen} preview={previewOpen ? previewResult : null} setSelection={(value) => { setSelection(value); if (!previewOpen) setMobileBuilderPanel("settings"); }} setInsertAt={setInsertAt} onAddStep={addStep} onDropFlowAction={dropAction} onNavigate={setSelection} onMoveStep={moveStep} onRemoveStep={removeStep} onUpdateStep={updateStep} />

    </div>
    <FlowPaletteOverlay />
    </DndContext>
    {quickCheckOpen ? <Suspense fallback={null}><LazyFlowCheckDialog flow={draft} flowId={draft.id} onOpenChange={setQuickCheckOpen} onDeliveryTest={() => { setQuickCheckOpen(false); setDeliveryTestRequested(true); setEmailTestPath(undefined); setEmailTestOpen(true); }} /></Suspense> : null}
    {scenarioLabOpen ? <Suspense fallback={null}><LazyScenarioLab flow={draft} onOpenChange={setScenarioLabOpen} /></Suspense> : null}
    {emailTestOpen ? <FlowEmailTestDialog key={emailTestPath?.join("-") || "journey"} flow={draft} initialSendReal={deliveryTestRequested} defaultRecipient={viewerEmail} messageStepPath={emailTestPath} sample={previewOpen && previewResult ? { facts: previewResult.facts, customerName: previewResult.customer?.name, email: previewResult.customer?.email } : undefined} open={emailTestOpen} onOpenChange={(open) => { setEmailTestOpen(open); if (!open) setDeliveryTestRequested(false); }} /> : null}

    <Dialog open={leaveDialogOpen} onOpenChange={open => { if (!saving && !open) { pendingNavigation.current = null; setLeaveDialogOpen(false); setPanelSaveError(""); } }}><DialogContent className="wf-unsaved-dialog sm:max-w-lg" showCloseButton={false}><DialogHeader><DialogTitle>Save changes?</DialogTitle><DialogDescription>You have unsaved changes. Save them before leaving, or discard them to continue.</DialogDescription></DialogHeader>{panelSaveError ? <p className="text-sm text-destructive" role="alert">{panelSaveError}</p> : null}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => { pendingNavigation.current = null; setLeaveDialogOpen(false); setPanelSaveError(""); }}>Keep editing</Button><Button variant="destructive" disabled={saving} onClick={discardPanelChanges}>Discard changes</Button><Button disabled={saving || autoSaving} onClick={() => void savePanel(true)}>{saving ? "Saving…" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={launchReviewOpen} onOpenChange={setLaunchReviewOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Review and turn on</DialogTitle><DialogDescription>Review this workflow before contacts can enter and actions begin running.</DialogDescription></DialogHeader><div className="max-h-[50dvh] space-y-2 overflow-y-auto">{auditFindings.map(finding => <AuditRow key={finding.id} severity={finding.severity} label={finding.label} />)}</div>{!auditCanLaunch ? <p className="text-sm text-destructive">Resolve the highlighted issues before turning on this workflow.</p> : <p className="text-sm text-muted-foreground">This workflow is ready to go live.</p>}<DialogFooter showCloseButton><Button disabled={!canEdit || saving || autoSaving || !auditCanLaunch} onClick={() => { setLaunchReviewOpen(false); void persist("live"); }}><Play />Turn on workflow</Button></DialogFooter></DialogContent></Dialog>
    {notice && !auditOpen ? <div className="wf-feedback"><NotificationToast tone="message">{notice}</NotificationToast></div> : null}
    <Dialog open={auditOpen} onOpenChange={setAuditOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><AiIcon className="size-4 text-violet-600" />Workflow audit</DialogTitle><DialogDescription>Checks configuration, B2B safety, message pressure, and customer experience before launch.</DialogDescription></DialogHeader><div className="max-h-[55vh] space-y-2 overflow-auto">{auditFindings.map((finding) => <AuditRow key={finding.id} severity={finding.severity} label={`${finding.label}${finding.step ? ` · step ${finding.step}` : ""}`} />)}</div>{notice ? <NotificationToast tone="message">{notice}</NotificationToast> : null}<DialogFooter showCloseButton><Button onClick={() => { setAuditOpen(false); if (!auditCanLaunch) setNotice("Resolve blocking audit findings before turning on this workflow."); }}><Check />{auditCanLaunch ? "Audit passed" : "Review findings"}</Button></DialogFooter></DialogContent></Dialog>
  </div></FlowEmailPerformanceProvider>;
}

function FlowListView({ flows, canEdit, viewerId, isAdmin, memberOptions, onCreate, onOpen, onDuplicate, onChangeStatus, onRemove, onBulkAction, scopedContext, collectionView, onViewChange }: {
  collectionView: FlowCollectionView;
  onViewChange: (view: FlowCollectionView) => void;
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
  const memberAvatars = new Map(memberOptions.map((member) => [member.id, member.avatarUrl]));
  const dateFormatter = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkBusyRef = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<Array<{ id: string; error: string }>>([]);
  const pageSize = 25;
  const filteredFlows = flows.filter(flow => (statusFilter === "all" || flow.status === statusFilter) && `${flow.name} ${String(flow.triggerConfig.scopeLabel || "")} ${formatTrigger(flow.triggerType, flow.triggerConfig)} ${memberLabels.get(flow.createdBy) ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filteredFlows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleFlows = filteredFlows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const canManage = (flow: AutomationFlow) => canEdit && (isAdmin || flow.createdBy === viewerId);
  const selectedFlows = flows.filter((flow) => selectedIds.includes(flow.id) && canManage(flow));
  const selectablePage = visibleFlows.filter(canManage);
  const allPageSelected = selectablePage.length > 0 && selectablePage.every((flow) => selectedIds.includes(flow.id));
  const somePageSelected = selectablePage.some((flow) => selectedIds.includes(flow.id));
  const CollectionContainer = collectionView === "boxes" ? "div" : Card;

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
    <div className="w-full px-5 pb-6 pt-2 sm:px-6">
      <PageActions>
        {!scopedContext ? <FlowViewToggle active={collectionView} onViewChange={onViewChange} /> : null}
        <Button onClick={onCreate} disabled={!canEdit || bulkBusy}><Plus />Create workflow</Button>
      </PageActions>

      <div className="crm-table-filter-bar mb-3">
        <label className="crm-table-filter crm-table-filter-search"><span className="sr-only">Search workflows</span><Input type="search" placeholder="Search workflows or triggers" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
        <label className="crm-table-filter"><span className="sr-only">Workflow status</span><Select value={statusFilter} onValueChange={value => { if (value) { setStatusFilter(value); setPage(1); } }}><SelectTrigger aria-label="Workflow status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="live">Live</SelectItem><SelectItem value="paused">Paused</SelectItem><SelectItem value="draft">Draft</SelectItem></SelectContent></Select></label>
        {query || statusFilter !== "all" ? <Button type="button" variant="ghost" size="sm" onClick={() => { setQuery(""); setStatusFilter("all"); setPage(1); }}>Clear filters</Button> : null}
      </div>
      <CollectionContainer className={collectionView === "boxes" ? "space-y-4" : "crm-table-frame crm-table-page-wide gap-0 py-0"}>
        {selectedFlows.length ? <div role="group" aria-label="Bulk workflow actions" aria-busy={bulkBusy} className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-3">
          <span className="mr-auto text-sm font-semibold">{t(`${selectedFlows.length} selected`)}</span>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void applyBulk("live")}><Play />Turn on</Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => void applyBulk("paused")}><Pause />Pause</Button>
          <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => setDeleteOpen(true)}><Trash2 />Delete</Button>
          <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelectedIds([])}>Clear selection</Button>
        </div> : null}
        {bulkErrors.length ? <NotificationToast><p className="font-medium">Some workflows could not be updated. Review the errors below.</p><ul className="mt-2 list-disc space-y-1 pl-5">{bulkErrors.map((item) => <li key={item.id}><span translate="no" className="font-medium">{flows.find((flow) => flow.id === item.id)?.name || item.id}</span>: {item.error}</li>)}</ul></NotificationToast> : null}
        {filteredFlows.length ? collectionView === "boxes" ? <>
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground"><Checkbox aria-label="Select all editable workflows on this page" checked={allPageSelected} indeterminate={!allPageSelected && somePageSelected} disabled={bulkBusy || !selectablePage.length} onCheckedChange={(checked) => selectFlows(checked ? [...new Set([...selectedFlows.map(flow => flow.id), ...selectablePage.map(flow => flow.id)])] : selectedIds.filter(id => !selectablePage.some(flow => flow.id === id)))} />Select all on this page<span className="ml-auto">{t(`${filteredFlows.length} workflows`)}</span></div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleFlows.map(flow => <Card key={flow.id} size="sm" role="article" aria-label={flow.name} className={`min-w-0 gap-0 py-0 transition-shadow ${selectedIds.includes(flow.id) ? "ring-2 ring-primary" : "hover:ring-foreground/20"}`}>
              <button type="button" className="block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" aria-label={`Open ${flow.name}`} disabled={bulkBusy} onClick={() => onOpen(flow)}><FlowDesignPreview flow={flow} /></button>
              <CardContent className="flex flex-1 flex-col gap-3 border-t p-4">
                <div className="flex items-center gap-2"><Checkbox aria-label={`Select ${flow.name}`} checked={selectedIds.includes(flow.id)} disabled={bulkBusy || !canManage(flow)} onCheckedChange={checked => selectFlows(checked ? [...selectedFlows.map(item => item.id), flow.id] : selectedIds.filter(id => id !== flow.id))} /><FlowStatusBadge status={flow.status} /><span className="ml-auto text-xs text-muted-foreground">{t(`${flowActionLocations(flow.steps).length} actions`)}</span><FlowActions flow={flow} canEdit={canManage(flow) && !bulkBusy} canDuplicate={canEdit && !bulkBusy} onOpen={onOpen} onDuplicate={onDuplicate} onChangeStatus={onChangeStatus} onRemove={onRemove} /></div>
                <h3><button type="button" className={`line-clamp-2 ${flowNameClassName}`} disabled={bulkBusy} onClick={() => onOpen(flow)}>{flow.name}</button></h3>
                <p className="truncate text-xs text-muted-foreground" title={formatTrigger(flow.triggerType, flow.triggerConfig)}>{formatTrigger(flow.triggerType, flow.triggerConfig)}{flow.triggerConfig.scopeLabel ? <> · <span data-no-translate>{String(flow.triggerConfig.scopeLabel)}</span></> : null}</p>
                {flow.dependencyIssue ? <p role="status" className="text-xs text-amber-700 dark:text-amber-400">Needs attention: {flow.dependencyIssue}</p> : null}
                <dl className="mt-auto flex gap-5 pt-1 text-xs"><div className="flex items-center gap-2"><dt className="text-muted-foreground">Active</dt><dd className="font-medium tabular-nums">{flow.activeRuns || 0}</dd></div><div className="flex items-center gap-2"><dt className="text-muted-foreground">Completed</dt><dd className="font-medium tabular-nums">{flow.completedRuns || 0}</dd></div></dl>
              </CardContent>
              <CardFooter className="flex-wrap justify-between gap-x-3 gap-y-2 bg-transparent px-4 py-3 text-xs text-muted-foreground">
                {isAdmin ? <span className="flex min-w-0 items-center gap-2"><UserAvatar userId={flow.createdBy} name={memberLabels.get(flow.createdBy) || (flow.createdBy === viewerId ? "You" : "Workspace member")} imageUrl={memberAvatars.get(flow.createdBy)} className="size-5" /><span className="truncate">{memberLabels.get(flow.createdBy) || (flow.createdBy === viewerId ? "You" : "Workspace member")}</span></span> : null}
                <time className="ml-auto" dateTime={flow.updatedAt}>{dateFormatter.format(new Date(flow.updatedAt))}</time>
              </CardFooter>
            </Card>)}
          </div>
        </> : <>
          <div>
            <Table className={`${isAdmin ? "min-w-[1040px]" : "min-w-[900px]"} [--ui-text-meta:14px]`}><caption className="sr-only">Workflows, trigger conditions, run counts, and available actions</caption>
              <TableHeader><TableRow className="bg-muted/30 hover:bg-muted/30"><TableHead className="crm-table-check"><Checkbox aria-label="Select all editable workflows on this page" checked={allPageSelected} indeterminate={!allPageSelected && somePageSelected} disabled={bulkBusy || !selectablePage.length} onCheckedChange={(checked) => selectFlows(checked ? [...new Set([...selectedFlows.map((flow) => flow.id), ...selectablePage.map((flow) => flow.id)])] : selectedIds.filter((id) => !selectablePage.some((flow) => flow.id === id)))} /></TableHead><TableHead>Workflow</TableHead>{isAdmin ? <TableHead>Created by</TableHead> : null}<TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead className="text-center">Active</TableHead><TableHead className="text-center">Completed</TableHead><TableHead>Last updated</TableHead><TableHead className="w-12"><span className="sr-only">Workflow actions</span></TableHead></TableRow></TableHeader>
              <TableBody>{visibleFlows.map((flow) => {
                const creatorName = memberLabels.get(flow.createdBy) || (flow.createdBy === viewerId ? "You" : "Workspace member");
                return <TableRow key={flow.id} data-state={selectedIds.includes(flow.id) ? "selected" : undefined} className="group cursor-pointer" onClick={() => { if (!bulkBusy) onOpen(flow); }}>
                  <TableCell className="crm-table-check" onClick={(event) => event.stopPropagation()}><Checkbox aria-label={`Select ${flow.name}`} checked={selectedIds.includes(flow.id)} disabled={bulkBusy || !canManage(flow)} onCheckedChange={(checked) => selectFlows(checked ? [...selectedFlows.map((item) => item.id), flow.id] : selectedIds.filter((id) => id !== flow.id))} /></TableCell>
                  <TableCell>
                    <button type="button" disabled={bulkBusy} onClick={event => { event.stopPropagation(); onOpen(flow); }} className={flowNameClassName}>{flow.name}</button>
                    {flow.dependencyIssue ? <p role="status" className="mt-1 max-w-72 text-xs text-amber-700 dark:text-amber-400">Needs attention: {flow.dependencyIssue}</p> : null}
                    <p className="text-xs leading-4 text-muted-foreground">{t(`${flowActionLocations(flow.steps).length} actions`)}{flow.triggerConfig.scopeLabel ? <> · <span data-no-translate>{String(flow.triggerConfig.scopeLabel)}</span></> : null}</p>
                  </TableCell>
                  {isAdmin ? <TableCell><div className="flex items-center gap-2"><UserAvatar userId={flow.createdBy} name={creatorName} imageUrl={memberAvatars.get(flow.createdBy)} className="size-6" /><span>{creatorName}</span></div></TableCell> : null}
                  <TableCell><p className="max-w-64 truncate text-sm">{formatTrigger(flow.triggerType, flow.triggerConfig)}</p></TableCell>
                  <TableCell><FlowStatusBadge status={flow.status} /></TableCell>
                  <TableCell className="text-center font-normal tabular-nums">{flow.activeRuns || 0}</TableCell>
                  <TableCell className="text-center font-normal tabular-nums">{flow.completedRuns || 0}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{dateFormatter.format(new Date(flow.updatedAt))}</TableCell>
                  <TableCell><FlowActions flow={flow} canEdit={canManage(flow) && !bulkBusy} canDuplicate={canEdit && !bulkBusy} onOpen={onOpen} onDuplicate={onDuplicate} onChangeStatus={onChangeStatus} onRemove={onRemove} /></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </div>



        </> : flows.length ? <EmptyState compact icon={Search} title="No matching workflows" description="Try another workflow name, trigger, creator, or status." className="border-0 bg-transparent" /> : <div className="grid min-h-64 place-items-center px-6 py-12 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Workflow className="size-5" /></span><h3 className="mt-4 font-semibold">Create your first workflow</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Automate timely follow-ups, internal tasks, and customer journey decisions.</p><Button className="mt-5" onClick={onCreate} disabled={!canEdit}><Plus />Create workflow</Button></div></div>}
      </CollectionContainer>
      <TablePagination className="mt-4" page={currentPage} pageCount={pageCount} start={visibleFlows.length ? (currentPage - 1) * pageSize + 1 : 0} end={Math.min(currentPage * pageSize, filteredFlows.length)} total={filteredFlows.length} itemLabel="workflows" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
      <ConfirmActionDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete selected workflows?" description={t("Delete the selected workflows and their run history? This cannot be undone.")} onConfirm={() => applyBulk("delete")} />
    </div>
  </section>;
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
