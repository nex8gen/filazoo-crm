"use client";

import { useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Bell, Check, CheckCircle2, ChevronRight,
  CircleStop, Clock3, Copy, Eye, GitBranch, History, ListFilter, Mail, MoreHorizontal,
  GripVertical, Maximize2, Minus, Pause, Play, Plus, Save, Search, Settings2, Sparkles, Tag, Trash2, UserRoundCheck, Workflow,
} from "lucide-react";
import { toast } from "sonner";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  blankStep, companyStatuses, defaultFlowInput, emailCategories, flowInputSchema, formatTrigger, pipelineStages, stepLabels, stepTypes,
  triggerLabels, triggerTypes, type AutomationFlow, type FlowInput, type FlowStatus, type FlowStepType,
  type JsonConfig, type TriggerType,
} from "@/lib/flows";

type Option = { id: string; label: string };
type FilterOptions = { segments: string[]; countries: string[] };
type DraftFlow = FlowInput & { id: string | null; activeRuns?: number; completedRuns?: number; updatedAt?: string };
type Selection = "trigger" | string;
type CanvasPoint = { x: number; y: number };
type CanvasPositions = Record<string, CanvasPoint>;

const templates: Option[] = [
  { id: "helpful_reminder", label: "Helpful reminder" },
  { id: "send_catalog", label: "Send relevant catalog" },
  { id: "quote_follow_up", label: "Quote follow-up" },
  { id: "welcome_intro", label: "Welcome introduction" },
  { id: "last_chance", label: "Last-chance follow-up" },
];
const conditionFields = [["customer_replied", "Customer replied"], ["category_is", "Category is"], ["opened_email", "Opened email"], ["clicked_link", "Clicked link"]] as const;
const conditionActions = [["stop_flow", "Stop flow"], ["continue", "Continue"], ["skip_next", "Skip next step"]] as const;

const stepMeta: Record<FlowStepType, { icon: typeof Mail; tone: string; group: "Message" | "Data" | "Logic"; description: string }> = {
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

function NumberInput({ value, onChange, min = 0, disabled }: { value: unknown; onChange: (value: number) => void; min?: number; disabled?: boolean }) {
  return <Input type="number" min={min} value={typeof value === "number" ? value : 0} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} />;
}

function statusVariant(status: FlowStatus) { return status === "live" ? "default" : status === "paused" ? "secondary" : "outline"; }
function titleCase(value: unknown) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function stepSummary(type: FlowStepType, config: JsonConfig) {
  if (type === "wait") return `Wait ${config.amount || 1} ${config.unit || "days"}${config.businessDays ? " · business time" : ""}`;
  if (type === "send_email") return templates.find((item) => item.id === config.templateId)?.label || "Choose an email template";
  if (type === "if_condition") return `${titleCase(config.field)} → ${titleCase(config.action)}`;
  if (type === "create_task") return String(config.title || "Create a CRM task");
  if (type === "change_category") return `Set category to ${config.category || "…"}`;
  if (type === "internal_alert") return String(config.message || "Notify a teammate");
  return "End this automation";
}

function ToggleField({ checked, onChange, label, detail, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; detail?: string; disabled?: boolean }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/40"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} disabled={disabled} className="mt-0.5" /><span><span className="block text-sm font-medium">{label}</span>{detail ? <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{detail}</span> : null}</span></label>;
}

function TriggerInspector({ draft, setDraft, filterOptions = { segments: [], countries: [] }, disabled }: { draft: DraftFlow; setDraft: (flow: DraftFlow) => void; filterOptions?: FilterOptions; disabled: boolean }) {
  const configs: Record<TriggerType, JsonConfig> = { email_received: {}, category_changed: { category: "Needs follow-up" }, no_reply: { amount: 2, unit: "days", businessDays: true }, lead_added_to_list: { listId: "Shopify B2B leads" }, company_segment_changed: { segment: filterOptions.segments[0] || "Shopify B2B lead" }, pipeline_stage_changed: { stage: "new" } };
  const updateConfig = (key: string, value: string | number | boolean | null) => setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, [key]: value } });
  const updateOptional = (key: string, value: string) => { const next = { ...draft.triggerConfig }; if (value === "__any") delete next[key]; else next[key] = value; setDraft({ ...draft, triggerConfig: next }); };
  const segmentOptions = [{ id: "__any", label: "Any segment" }, ...filterOptions.segments.map((value) => ({ id: value, label: value }))];
  const countryOptions = [{ id: "__any", label: "Any country" }, ...filterOptions.countries.map((value) => ({ id: value, label: value }))];
  return <div className="space-y-5"><div><p className="text-sm font-semibold">Journey trigger</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the real CRM event that enrolls a contact.</p></div><div className="space-y-2"><Label>Trigger event</Label><FlowSelect value={draft.triggerType} onChange={(value) => { const type = value as TriggerType; setDraft({ ...draft, triggerType: type, triggerConfig: configs[type] }); }} options={triggerTypes.map((value) => [value, triggerLabels[value]] as const)} disabled={disabled} /></div>{draft.triggerType === "category_changed" ? <div className="space-y-2"><Label>Email category</Label><FlowSelect value={String(draft.triggerConfig.category || "Needs follow-up")} onChange={(value) => updateConfig("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div> : null}{draft.triggerType === "no_reply" ? <><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Duration</Label><NumberInput min={1} value={draft.triggerConfig.amount} onChange={(value) => updateConfig("amount", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Unit</Label><FlowSelect value={String(draft.triggerConfig.unit || "days")} onChange={(value) => updateConfig("unit", value)} options={[["hours", "Hours"], ["days", "Days"]]} disabled={disabled} /></div></div><ToggleField checked={Boolean(draft.triggerConfig.businessDays)} onChange={(value) => updateConfig("businessDays", value)} label="Count business days only" detail="Skip weekends when evaluating the trigger." disabled={disabled} /></> : null}{draft.triggerType === "lead_added_to_list" ? <div className="space-y-2"><Label>Lead list</Label><Input value={String(draft.triggerConfig.listId || "")} onChange={(event) => updateConfig("listId", event.target.value)} placeholder="Shopify B2B leads" disabled={disabled} /></div> : null}{draft.triggerType === "company_segment_changed" ? <div className="space-y-2"><Label>Company segment</Label>{filterOptions.segments.length ? <FlowSelect value={String(draft.triggerConfig.segment || filterOptions.segments[0])} onChange={(value) => updateConfig("segment", value)} options={filterOptions.segments.map((value) => ({ id: value, label: value }))} disabled={disabled} /> : <Input value={String(draft.triggerConfig.segment || "")} onChange={(event) => updateConfig("segment", event.target.value)} placeholder="Enter a CRM segment" disabled={disabled} />}</div> : null}{draft.triggerType === "pipeline_stage_changed" ? <div className="space-y-2"><Label>Pipeline stage</Label><FlowSelect value={String(draft.triggerConfig.stage || "new")} onChange={(value) => updateConfig("stage", value)} options={pipelineStages.map((value) => [value, titleCase(value)] as const)} disabled={disabled} /></div> : null}<div className="space-y-3 border-t pt-4"><div><p className="text-xs font-semibold">Company filters</p><p className="mt-1 text-[11px] text-muted-foreground">All selected filters must match before enrollment.</p></div>{draft.triggerType !== "company_segment_changed" ? <div className="space-y-2"><Label>Segment</Label><FlowSelect value={String(draft.triggerConfig.segment || "__any")} onChange={(value) => updateOptional("segment", value)} options={segmentOptions} disabled={disabled} /></div> : null}<div className="space-y-2"><Label>Country</Label><FlowSelect value={String(draft.triggerConfig.country || "__any")} onChange={(value) => updateOptional("country", value)} options={countryOptions} disabled={disabled} /></div><div className="space-y-2"><Label>Company status</Label><FlowSelect value={String(draft.triggerConfig.companyStatus || "__any")} onChange={(value) => updateOptional("companyStatus", value)} options={[{ id: "__any", label: "Any status" }, ...companyStatuses.map((value) => ({ id: value, label: titleCase(value) }))]} disabled={disabled} /></div><div className="space-y-2"><Label>Pipeline stage filter</Label><FlowSelect value={String(draft.triggerConfig.pipelineStage || "__any")} onChange={(value) => updateOptional("pipelineStage", value)} options={[{ id: "__any", label: "Any stage" }, ...pipelineStages.map((value) => ({ id: value, label: titleCase(value) }))]} disabled={disabled} /></div><div className="space-y-2"><Label>Minimum fit score</Label><NumberInput min={0} value={draft.triggerConfig.minFitScore ?? 0} onChange={(value) => { const next = { ...draft.triggerConfig }; if (value <= 0) delete next.minFitScore; else next.minFitScore = value; setDraft({ ...draft, triggerConfig: next }); }} disabled={disabled} /></div></div><div className="rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Enrollment:</strong> Each conversation can have only one active run in this flow.</div></div>;
}

function BaseStepInspector({ type, config, onChange, mailboxes, members, disabled }: { type: FlowStepType; config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; members: Option[]; disabled: boolean }) {
  const set = (key: string, value: string | number | boolean | null) => onChange({ ...config, [key]: value });
  return <div className="space-y-5"><div><p className="text-sm font-semibold">{stepLabels[type]}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{stepMeta[type].description}</p></div>{type === "wait" ? <><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Duration</Label><NumberInput min={1} value={config.amount} onChange={(value) => set("amount", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Unit</Label><FlowSelect value={String(config.unit || "days")} onChange={(value) => set("unit", value)} options={[["minutes", "Minutes"], ["hours", "Hours"], ["days", "Days"]]} disabled={disabled} /></div></div><ToggleField checked={Boolean(config.businessDays)} onChange={(value) => set("businessDays", value)} label="Business days only" detail="Skip Saturday and Sunday." disabled={disabled} /><div className="space-y-2"><Label>Resume at</Label><Input type="time" value={String(config.resumeAt || "09:00")} onChange={(event) => set("resumeAt", event.target.value)} disabled={disabled} /></div></> : null}{type === "if_condition" ? <><div className="space-y-2"><Label>Condition</Label><FlowSelect value={String(config.field || "customer_replied")} onChange={(value) => set("field", value)} options={conditionFields} disabled={disabled} /></div>{config.field === "category_is" ? <div className="space-y-2"><Label>Category</Label><FlowSelect value={String(config.category || "Needs follow-up")} onChange={(value) => set("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div> : null}<div className="space-y-2"><Label>Lookback window</Label><div className="flex items-center gap-2"><NumberInput min={1} value={config.lookbackDays ?? 7} onChange={(value) => set("lookbackDays", value)} disabled={disabled} /><span className="text-xs text-muted-foreground">days</span></div></div><div className="space-y-2"><Label>If matched</Label><FlowSelect value={String(config.action || "stop_flow")} onChange={(value) => set("action", value)} options={conditionActions} disabled={disabled} /></div></> : null}{type === "send_email" ? <><div className="space-y-2"><Label>Email template</Label><FlowSelect value={String(config.templateId || "")} onChange={(value) => set("templateId", value)} options={templates} placeholder="Choose a template" disabled={disabled} /></div><div className="space-y-2"><Label>Sender mailbox</Label><FlowSelect value={String(config.mailboxId || "")} onChange={(value) => set("mailboxId", value)} options={mailboxes} placeholder="Choose a mailbox" disabled={disabled} /></div><div className="space-y-2"><Label>Subject override</Label><Input value={String(config.subject || "")} onChange={(event) => set("subject", event.target.value)} placeholder="Use template subject" disabled={disabled} /></div><div className="space-y-2"><Label>Preheader</Label><Input value={String(config.preheader || "")} onChange={(event) => set("preheader", event.target.value)} placeholder="Inbox preview text" disabled={disabled} /></div><div className="space-y-2"><Label>Send window</Label><FlowSelect value={String(config.sendWindow || "business_hours")} onChange={(value) => set("sendWindow", value)} options={[["business_hours", "Recipient business hours"], ["anytime", "Any time"]]} disabled={disabled} /></div><div className="space-y-2"><ToggleField checked={Boolean(config.replyInThread)} onChange={(value) => set("replyInThread", value)} label="Reply in same thread" disabled={disabled} /><ToggleField checked={config.trackOpens !== false} onChange={(value) => set("trackOpens", value)} label="Track opens" disabled={disabled} /><ToggleField checked={config.trackClicks !== false} onChange={(value) => set("trackClicks", value)} label="Track link clicks" disabled={disabled} /><ToggleField checked={config.utmTracking !== false} onChange={(value) => set("utmTracking", value)} label="Add UTM tracking" disabled={disabled} /><ToggleField checked={config.stopOnReply !== false} onChange={(value) => set("stopOnReply", value)} label="Stop if customer replies" disabled={disabled} /></div></> : null}{type === "create_task" ? <><div className="space-y-2"><Label>Task title</Label><Input value={String(config.title || "")} onChange={(event) => set("title", event.target.value)} disabled={disabled} /></div><div className="space-y-2"><Label>Assign to</Label><FlowSelect value={String(config.assigneeType || "owner")} onChange={(value) => set("assigneeType", value)} options={[["owner", "Conversation owner"], ["user", "Specific user"]]} disabled={disabled} /></div>{config.assigneeType === "user" ? <div className="space-y-2"><Label>Team member</Label><FlowSelect value={String(config.assigneeId || "")} onChange={(value) => set("assigneeId", value)} options={members} placeholder="Choose a user" disabled={disabled} /></div> : null}<div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Due in days</Label><NumberInput value={config.dueInDays} onChange={(value) => set("dueInDays", value)} disabled={disabled} /></div><div className="space-y-2"><Label>Priority</Label><FlowSelect value={String(config.priority || "normal")} onChange={(value) => set("priority", value)} options={[["low", "Low"], ["normal", "Normal"], ["high", "High"]]} disabled={disabled} /></div></div><div className="space-y-2"><Label>Notes</Label><Textarea value={String(config.notes || "")} onChange={(event) => set("notes", event.target.value)} placeholder="Instructions for the assignee" disabled={disabled} /></div></> : null}{type === "change_category" ? <><div className="space-y-2"><Label>New category</Label><FlowSelect value={String(config.category || "Needs follow-up")} onChange={(value) => set("category", value)} options={emailCategories.map((value) => [value, value] as const)} disabled={disabled} /></div><div className="space-y-2"><Label>Internal reason</Label><Textarea value={String(config.reason || "")} onChange={(event) => set("reason", event.target.value)} placeholder="Why this category is applied" disabled={disabled} /></div></> : null}{type === "internal_alert" ? <><div className="space-y-2"><Label>Notify</Label><FlowSelect value={String(config.userId || "owner")} onChange={(value) => set("userId", value)} options={[{ id: "owner", label: "Conversation owner" }, ...members]} disabled={disabled} /></div><div className="space-y-2"><Label>Delivery</Label><FlowSelect value={String(config.channel || "in_app")} onChange={(value) => set("channel", value)} options={[["in_app", "In-app notification"], ["email", "Email notification"]]} disabled={disabled} /></div><div className="space-y-2"><Label>Message</Label><Textarea value={String(config.message || "")} onChange={(event) => set("message", event.target.value)} disabled={disabled} /></div><ToggleField checked={config.includeThreadLink !== false} onChange={(value) => set("includeThreadLink", value)} label="Include conversation link" disabled={disabled} /></> : null}{type === "stop" ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Contacts reaching this step leave the flow immediately. Later steps will not run.</div> : null}</div>;
}

function StepInspector(props: { type: FlowStepType; config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: Option[]; members: Option[]; disabled: boolean }) {
  const { type, config, onChange, disabled } = props;
  const set = (key: string, value: string | number | boolean | null) => onChange({ ...config, [key]: value });
  return <div><BaseStepInspector {...props} />{type === "if_condition" ? <div className="mt-5 space-y-2"><Label>If not matched</Label><FlowSelect value={String(config.unmatchedAction || "continue")} onChange={(value) => set("unmatchedAction", value)} options={conditionActions} disabled={disabled} /></div> : null}{type === "stop" ? <div className="mt-5 space-y-4"><div className="space-y-2"><Label>Reason</Label><Input value={String(config.reason || "")} onChange={(event) => set("reason", event.target.value)} placeholder="Why the automation ends here" disabled={disabled} /></div><div className="space-y-2"><Label>Run outcome</Label><FlowSelect value={String(config.outcome || "completed")} onChange={(value) => set("outcome", value)} options={[["completed", "Completed"], ["cancelled", "Cancelled"]]} disabled={disabled} /></div></div> : null}</div>;
}

function FlowNode({ step, index, selected, onSelect, onMove, onRemove, onPointerDown, disabled }: { step: FlowInput["steps"][number]; index: number; selected: boolean; onSelect: () => void; onMove: (offset: number) => void; onRemove: () => void; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void; disabled: boolean }) {
  const meta = stepMeta[step.type]; const Icon = meta.icon;
  return <div role="button" tabIndex={0} aria-pressed={selected} aria-label={`${stepLabels[step.type]}, step ${index + 1}. Drag to reposition.`} onPointerDown={onPointerDown} onClick={onSelect} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} className={`group relative w-[32rem] max-w-[calc(100vw-3rem)] touch-none cursor-grab rounded-xl border bg-background p-4 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary ring-2 ring-primary/15" : ""}`}><div className="flex items-start gap-3"><span className="mt-2 text-muted-foreground/45 transition group-hover:text-muted-foreground"><GripVertical className="size-4" /></span><span className={`grid size-9 shrink-0 place-items-center rounded-lg ${meta.tone}`}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold">{stepLabels[step.type]}</p><Badge variant="outline" className="text-[10px]">Step {index + 1}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{stepSummary(step.type, step.config)}</p>{step.type === "send_email" ? <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5 text-center"><div><p className="text-[10px] text-muted-foreground">Sent</p><p className="mt-0.5 text-xs font-semibold">0</p></div><div><p className="text-[10px] text-muted-foreground">Opens</p><p className="mt-0.5 text-xs font-semibold">—</p></div><div><p className="text-[10px] text-muted-foreground">Clicks</p><p className="mt-0.5 text-xs font-semibold">—</p></div></div> : null}</div><div data-no-drag className="flex gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"><Button type="button" variant="ghost" size="icon-xs" onClick={(event) => { event.stopPropagation(); onMove(-1); }} disabled={disabled || index === 0} aria-label="Move up"><ArrowUp /></Button><Button type="button" variant="ghost" size="icon-xs" onClick={(event) => { event.stopPropagation(); onMove(1); }} disabled={disabled} aria-label="Move down"><ArrowDown /></Button><Button type="button" variant="ghost" size="icon-xs" onClick={(event) => { event.stopPropagation(); onRemove(); }} disabled={disabled} aria-label="Remove"><Trash2 /></Button></div></div></div>;
}

function FlowCanvas({ draft, selection, insertAt, canEdit, setSelection, setInsertAt, onAddStep, onMoveStep, onRemoveStep }: { draft: DraftFlow; selection: Selection; insertAt: number | null; canEdit: boolean; setSelection: (selection: Selection) => void; setInsertAt: (position: number | null) => void; onAddStep: (type: FlowStepType, position?: number) => FlowInput["steps"][number] | null; onMoveStep: (index: number, offset: number) => void; onRemoveStep: (index: number) => void }) {
  const viewportRef = useRef<HTMLElement>(null);
  const [positions, setPositions] = useState<CanvasPositions>(() => {
    const initial: CanvasPositions = { __trigger: { x: 260, y: 80 } };
    draft.steps.forEach((step, index) => { initial[step.id || `step-${index}`] = { x: 260, y: 250 + index * 180 }; });
    return initial;
  });
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState<CanvasPoint>({ x: 0, y: 24 });
  const [panning, setPanning] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const panRef = useRef<{ start: CanvasPoint; origin: CanvasPoint } | null>(null);
  const dragRef = useRef<{ id: string; start: CanvasPoint; origin: CanvasPoint } | null>(null);
  const triggerId = "__trigger";
  const endId = "__end";

  const pointFor = (id: string, fallback: CanvasPoint) => positions[id] || fallback;
  const triggerPosition = pointFor(triggerId, { x: 260, y: 80 });
  const stepPositions = draft.steps.map((step, index) => pointFor(step.id || `step-${index}`, { x: 260, y: 250 + index * 180 }));
  const endPosition = pointFor(endId, { x: 435, y: 250 + draft.steps.length * 180 });
  const nodes = [{ x: triggerPosition.x, y: triggerPosition.y, width: 512, height: 118 }, ...stepPositions.map((position, index) => ({ x: position.x, y: position.y, width: 512, height: draft.steps[index]?.type === "send_email" ? 142 : 92 })), { x: endPosition.x, y: endPosition.y, width: 162, height: 34 }];

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

  function startNodeDrag(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (!canEdit || event.button !== 0 || (event.target as HTMLElement).closest("[data-no-drag]")) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, start: { x: event.clientX, y: event.clientY }, origin: pointFor(id, { x: 260, y: 250 }) };
  }

  function moveNode(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setPositions((current) => ({ ...current, [drag.id]: { x: drag.origin.x + (event.clientX - drag.start.x) / zoom, y: drag.origin.y + (event.clientY - drag.start.y) / zoom } }));
  }

  function endNodeDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
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

  function dropPaletteItem(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(false);
    if (!canEdit) return;
    const type = event.dataTransfer.getData("application/x-filazoo-flow-step") as FlowStepType;
    if (!stepTypes.includes(type)) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const step = onAddStep(type);
    if (!step?.id) return;
    setPositions((current) => ({ ...current, [step.id!]: { x: (event.clientX - rect.left - pan.x) / zoom - 256, y: (event.clientY - rect.top - pan.y) / zoom - 45 } }));
  }

  const connectorNodes = nodes.slice(0, -1).map((node, index) => ({ from: node, to: nodes[index + 1]!, insertAt: index }));

  return <main ref={viewportRef} aria-label="Flow canvas. Drag the background to pan and drag cards to reposition them." onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDropActive(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false); }} onDrop={dropPaletteItem} className={`relative min-h-[640px] touch-none overflow-hidden bg-muted/10 select-none ${panning ? "cursor-grabbing" : "cursor-grab"} ${dropActive ? "ring-2 ring-inset ring-primary/45" : ""}`} style={{ backgroundImage: "radial-gradient(circle, color-mix(in oklch, var(--border), transparent 25%) 1px, transparent 1px)", backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${22 * zoom}px ${22 * zoom}px` }}>
    <div className="absolute left-0 top-0 h-[2400px] w-[2400px] origin-top-left will-change-transform" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {connectorNodes.map(({ from, to }, index) => { const x1 = from.x + from.width / 2; const y1 = from.y + from.height; const x2 = to.x + to.width / 2; const y2 = to.y; const bend = Math.max(50, Math.abs(y2 - y1) * 0.45); return <path key={index} d={`M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`} fill="none" stroke="currentColor" strokeWidth="2" className="text-border" vectorEffect="non-scaling-stroke" />; })}
      </svg>
      {connectorNodes.map(({ from, to, insertAt: position }) => <div key={`add-${position}`} data-canvas-node className="absolute z-20" style={{ left: (from.x + from.width / 2 + to.x + to.width / 2) / 2 - 14, top: (from.y + from.height + to.y) / 2 - 14 }}><button type="button" onClick={(event) => { event.stopPropagation(); setInsertAt(insertAt === position ? null : position); }} disabled={!canEdit} aria-label={`Add action at position ${position + 1}`} className="grid size-7 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition hover:scale-110 hover:border-primary hover:text-primary disabled:opacity-50"><Plus className="size-4" /></button>{insertAt === position ? <div data-no-drag className="absolute left-1/2 top-9 z-30 grid w-72 -translate-x-1/2 grid-cols-2 gap-1 rounded-xl border bg-popover p-2 shadow-xl">{stepTypes.map((type) => { const Icon = stepMeta[type].icon; return <button key={type} type="button" onClick={() => { const step = onAddStep(type, position); if (step?.id) setPositions((current) => ({ ...current, [step.id!]: { x: (from.x + from.width / 2 + to.x + to.width / 2) / 2 - 256, y: (from.y + from.height + to.y) / 2 - 45 } })); }} className="flex items-center gap-2 rounded-lg p-2 text-left hover:bg-muted"><Icon className="size-3.5 text-muted-foreground" /><span className="text-xs font-medium">{stepLabels[type]}</span></button>; })}</div> : null}</div>)}
      <div data-canvas-node className="absolute" style={{ left: triggerPosition.x, top: triggerPosition.y }} onPointerDown={(event) => startNodeDrag(event, triggerId)} onPointerMove={moveNode} onPointerUp={endNodeDrag} onPointerCancel={endNodeDrag}><button type="button" onClick={() => setSelection("trigger")} className={`w-[32rem] rounded-xl border bg-background p-4 text-left shadow-sm transition-shadow hover:shadow-md ${selection === "trigger" ? "border-primary ring-2 ring-primary/15" : ""}`}><div className="flex items-start gap-3"><span className="mt-3 text-muted-foreground/45"><GripVertical className="size-4" /></span><span className="grid size-10 place-items-center rounded-full bg-foreground text-background"><Workflow className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between"><p className="text-sm font-semibold">Trigger</p><Badge variant="outline">Enrollment</Badge></div><p className="mt-1 text-xs text-muted-foreground">{formatTrigger(draft.triggerType, draft.triggerConfig)}</p><div className="mt-3 flex flex-wrap gap-1.5"><Badge variant="secondary" className="text-[10px]"><ListFilter />Profile filters</Badge><Badge variant="outline" className="text-[10px]">One active run per conversation</Badge></div></div></div></button></div>
      {draft.steps.map((step, index) => { const id = step.id || `step-${index}`; const position = stepPositions[index]!; return <div key={id} data-canvas-node className="absolute" style={{ left: position.x, top: position.y }} onPointerMove={moveNode} onPointerUp={endNodeDrag} onPointerCancel={endNodeDrag}><FlowNode step={step} index={index} selected={selection === step.id} onSelect={() => setSelection(step.id!)} onPointerDown={(event) => startNodeDrag(event, id)} onMove={(offset) => onMoveStep(index, offset)} onRemove={() => onRemoveStep(index)} disabled={!canEdit} /></div>; })}
      <div data-canvas-node className="absolute touch-none" style={{ left: endPosition.x, top: endPosition.y }} onPointerDown={(event) => startNodeDrag(event, endId)} onPointerMove={moveNode} onPointerUp={endNodeDrag} onPointerCancel={endNodeDrag}><div className="cursor-grab rounded-full border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm active:cursor-grabbing"><CheckCircle2 className="mr-1 inline size-3.5" />End of flow</div></div>
    </div>
    {dropActive ? <div className="pointer-events-none absolute inset-5 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5"><span className="rounded-full bg-background px-4 py-2 text-xs font-semibold text-primary shadow-sm">Drop action anywhere on the canvas</span></div> : null}
    <div data-canvas-controls className="absolute bottom-5 right-5 z-50 flex items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur"><button type="button" onClick={() => changeZoom(zoom - 0.1)} aria-label="Zoom out" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Minus className="size-4" /></button><span className="w-11 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => changeZoom(zoom + 0.1)} aria-label="Zoom in" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-4" /></button><span className="mx-1 h-5 w-px bg-border" /><button type="button" onClick={fitView} aria-label="Fit flow to canvas" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Maximize2 className="size-4" /></button></div>
    <div className="pointer-events-none absolute bottom-6 left-6 rounded-full border bg-background/85 px-3 py-1.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur">Drag canvas to pan · Drag cards to move</div>
  </main>;
}

export function FlowBuilder({ initialFlows, mailboxOptions, memberOptions, initialFlowId, canEdit }: { initialFlows: AutomationFlow[]; mailboxOptions: Option[]; memberOptions: Option[]; initialFlowId?: string; canEdit: boolean; filterOptions: FilterOptions }) {
  const [flows, setFlows] = useState(initialFlows);
  const initial = initialFlowId === "default" ? initialFlows.find((flow) => flow.name === "3-step follow-up") : initialFlows.find((flow) => flow.id === initialFlowId) || initialFlows[0];
  const [draft, setDraft] = useState<DraftFlow | null>(initial ? toDraft(initial) : null);
  const [view, setView] = useState<"list" | "builder">(initial ? "builder" : "list");
  const [selection, setSelection] = useState<Selection>("trigger");
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [auditOpen, setAuditDialogOpen] = useState(false);

  const mailboxes = useMemo(() => [{ id: "owner", label: "Owner's mailbox" }, { id: "default", label: "Default workspace mailbox" }, ...mailboxOptions.filter((option) => option.id !== "owner" && option.id !== "default")], [mailboxOptions]);
  const palette = useMemo(() => stepTypes.filter((type) => `${stepLabels[type]} ${stepMeta[type].description}`.toLowerCase().includes(paletteQuery.toLowerCase())), [paletteQuery]);
  const selectedIndex = draft?.steps.findIndex((step) => step.id === selection) ?? -1;
  const audit = draft ? flowInputSchema.safeParse(draft) : null;

  function openFlow(flow: AutomationFlow) { setDraft(toDraft(flow)); setSelection("trigger"); setView("builder"); setErrors({}); setNotice(""); }
  function updateStep(index: number, config: JsonConfig) { if (!draft) return; setDraft({ ...draft, steps: draft.steps.map((step, i) => i === index ? { ...step, config } : step) }); }
  function moveStep(index: number, offset: number) { if (!draft) return; const target = index + offset; if (target < 0 || target >= draft.steps.length) return; const steps = [...draft.steps]; [steps[index], steps[target]] = [steps[target]!, steps[index]!]; setDraft({ ...draft, steps }); }
  function addStep(type: FlowStepType, position = draft?.steps.length ?? 0) { if (!draft || !canEdit) return null; const step = blankStep(type); const steps = [...draft.steps]; steps.splice(position, 0, step); setDraft({ ...draft, steps }); setSelection(step.id!); setInsertAt(null); return step; }
  function removeStep(index: number) { if (!draft) return; const steps = draft.steps.filter((_, i) => i !== index); setDraft({ ...draft, steps }); setSelection(steps[Math.min(index, steps.length - 1)]?.id || "trigger"); }

  async function setAuditOpen(open: boolean) {
    setAuditDialogOpen(open);
    if (!open || !draft?.id) return;
    setNotice("Running a safe backend test…");
    try {
      const response = await fetch(`/api/flows/${draft.id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json().catch(() => ({ ok: false, error: "The test returned an invalid response." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Flow test failed.");
      setNotice(`Backend test passed · ${result.trace.length} execution checks completed in dry-run mode.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Flow test failed.");
    }
  }

  async function persist(status: FlowStatus = draft?.status ?? "draft") {
    if (!draft || !canEdit) return;
    const payload = { name: draft.name, triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, status, steps: draft.steps };
    const parsed = flowInputSchema.safeParse(payload);
    if (!parsed.success) { const next: Record<string, string> = {}; parsed.error.issues.forEach((issue) => { const key = issue.path[0] === "steps" ? `step-${String(issue.path[1])}` : String(issue.path[0] || "form"); next[key] ||= issue.message; }); setErrors(next); setNotice("Complete the highlighted settings before saving."); return; }
    setSaving(true); setErrors({}); setNotice("");
    try { const response = await fetch(draft.id ? `/api/flows/${draft.id}` : "/api/flows", { method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }); const result = await response.json().catch(() => ({ ok: false, error: "The server returned an invalid response." })); if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save flow."); const flow = result.flow as AutomationFlow; setFlows((current) => current.some((item) => item.id === flow.id) ? current.map((item) => item.id === flow.id ? flow : item) : [flow, ...current]); setDraft(toDraft(flow)); setNotice(status === "live" ? "Flow is live." : status === "paused" ? "Flow paused." : "All changes saved."); toast.success(status === "live" ? "Automation turned on" : status === "paused" ? "Automation paused" : "Flow saved"); } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save flow."); } finally { setSaving(false); }
  }

  async function removeFlow(flow: AutomationFlow) { if (!canEdit || !window.confirm(`Delete “${flow.name}”? This also removes its run history.`)) return; const response = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" }); const result = await response.json().catch(() => ({ ok: false })); if (!response.ok || !result.ok) return toast.error(result.error || "Unable to delete flow."); setFlows((current) => current.filter((item) => item.id !== flow.id)); if (draft?.id === flow.id) { setDraft(null); setView("list"); } toast.success("Flow deleted"); }
  async function duplicateFlow(flow: AutomationFlow) { if (!canEdit) return; const payload = { ...toDraft(flow), id: undefined, name: `${flow.name} copy`, status: "draft" as const, steps: flow.steps.map((step) => ({ type: step.type, config: step.config })) }; const response = await fetch("/api/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json().catch(() => ({ ok: false })); if (!response.ok || !result.ok) return toast.error(result.error || "Unable to duplicate flow."); setFlows((current) => [result.flow, ...current]); openFlow(result.flow); toast.success("Flow duplicated"); }
  async function changeStatus(flow: AutomationFlow, status: FlowStatus) { if (!canEdit) return; const payload = { ...toDraft(flow), status, steps: flow.steps.map((step) => ({ id: step.id, type: step.type, config: step.config })) }; const response = await fetch(`/api/flows/${flow.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json().catch(() => ({ ok: false })); if (!response.ok || !result.ok) return toast.error(result.error || "Unable to update flow."); setFlows((current) => current.map((item) => item.id === flow.id ? result.flow : item)); if (draft?.id === flow.id) setDraft(toDraft(result.flow)); toast.success(status === "live" ? "Automation turned on" : "Automation paused"); }

  if (view === "list" || !draft) return <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Flows</h2><p className="mt-1 text-xs text-muted-foreground">Create, monitor, and manage customer journeys.</p></div><Button onClick={() => { setDraft(newDraft()); setSelection("trigger"); setView("builder"); }} disabled={!canEdit}><Plus />Create flow</Button></div><Card className="overflow-hidden py-0 shadow-none"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Flow</TableHead><TableHead>Trigger</TableHead><TableHead>Status</TableHead><TableHead>Active</TableHead><TableHead>Completed</TableHead><TableHead>Last updated</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{flows.map((flow) => <TableRow key={flow.id} className="cursor-pointer" onClick={() => openFlow(flow)}><TableCell><p className="font-medium">{flow.name}</p><p className="text-xs text-muted-foreground">{flow.steps.length} actions</p></TableCell><TableCell className="text-xs">{formatTrigger(flow.triggerType, flow.triggerConfig)}</TableCell><TableCell><Badge variant={statusVariant(flow.status)} className="capitalize">{flow.status}</Badge></TableCell><TableCell>{flow.activeRuns}</TableCell><TableCell>{flow.completedRuns}</TableCell><TableCell className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(flow.updatedAt))}</TableCell><TableCell onClick={(event) => event.stopPropagation()}><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${flow.name}`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openFlow(flow)}>Edit</DropdownMenuItem><DropdownMenuItem onClick={() => void duplicateFlow(flow)} disabled={!canEdit}><Copy />Duplicate</DropdownMenuItem><DropdownMenuItem onClick={() => void changeStatus(flow, flow.status === "live" ? "paused" : "live")} disabled={!canEdit}>{flow.status === "live" ? <Pause /> : <Play />}{flow.status === "live" ? "Pause" : "Turn on"}</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => void removeFlow(flow)} disabled={!canEdit}><Trash2 />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody></Table></div></Card></div>;

  const selectedStep = selectedIndex >= 0 ? draft.steps[selectedIndex] : null;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 [&>header]:static! [&>header]:shrink-0">
    <header className="sticky top-12 z-20 flex min-h-14 flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur"><button type="button" onClick={() => setView("list")} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Flows</button><ChevronRight className="size-3.5 text-muted-foreground" /><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="h-8 w-64 border-transparent px-2 text-sm font-semibold hover:border-input focus:border-input" disabled={!canEdit} /><Badge variant={statusVariant(draft.status)} className="capitalize">{draft.status}</Badge><span className="hidden text-xs text-muted-foreground xl:inline">{draft.steps.length} actions · {draft.activeRuns || 0} active</span><div className="ml-auto flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setAuditOpen(true)}><Sparkles />Audit flow</Button><Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}><Eye />Preview</Button><Button variant="outline" size="sm" onClick={() => void persist(draft.status)} disabled={!canEdit || saving}><Save />{saving ? "Saving…" : "Save"}</Button>{draft.status === "live" ? <Button size="sm" variant="secondary" onClick={() => void persist("paused")} disabled={!canEdit || saving}><Pause />Pause</Button> : <Button size="sm" onClick={() => void persist("live")} disabled={!canEdit || saving}><Play />Turn on</Button>}</div></header>
    {!canEdit ? <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Viewer access is read-only.</div> : null}
    <div className="flex min-h-0 flex-1 flex-nowrap overflow-hidden [&>aside]:min-h-0 [&>aside]:overflow-y-auto [&>aside:first-child]:w-60 [&>aside:first-child]:shrink-0 [&>aside:last-child]:hidden [&>aside:last-child]:w-80 [&>aside:last-child]:shrink-0 md:[&>aside:last-child]:block xl:[&>aside:last-child]:w-[340px] [&>main]:min-h-0! [&>main]:min-w-0 [&>main]:flex-1">
      <aside className="hidden border-r bg-background p-4 xl:block"><div className="mb-4 flex items-center justify-between"><div><p className="text-sm font-semibold">Actions</p><p className="mt-0.5 text-xs text-muted-foreground">Drag to canvas or click to add</p></div><Workflow className="size-4 text-muted-foreground" /></div><div className="relative mb-4"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" /><Input value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Find an action" className="pl-8" /></div>{(["Message", "Data", "Logic"] as const).map((group) => <div key={group} className="mb-5"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group}</p><div className="space-y-1">{palette.filter((type) => stepMeta[type].group === group).map((type) => { const meta = stepMeta[type]; const Icon = meta.icon; return <button key={type} type="button" draggable={canEdit} onDragStart={(event) => { event.dataTransfer.setData("application/x-filazoo-flow-step", type); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addStep(type)} disabled={!canEdit} className="flex w-full cursor-grab items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-muted active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"><span className={`grid size-7 place-items-center rounded-md ${meta.tone}`}><Icon className="size-3.5" /></span><span><span className="block text-xs font-medium">{stepLabels[type]}</span><span className="block text-[10px] text-muted-foreground">{meta.description}</span></span><GripVertical className="ml-auto size-3.5 text-muted-foreground/50" /></button>; })}</div></div>)}<button type="button" onClick={() => setAuditOpen(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-100 to-blue-100 px-3 py-2.5 text-xs font-semibold text-violet-700 dark:from-violet-500/10 dark:to-blue-500/10 dark:text-violet-300"><Sparkles className="size-3.5" />Audit this flow</button></aside>
      <FlowCanvas key={draft.id || "new-flow"} draft={draft} selection={selection} insertAt={insertAt} canEdit={canEdit} setSelection={setSelection} setInsertAt={setInsertAt} onAddStep={addStep} onMoveStep={moveStep} onRemoveStep={removeStep} />
      <aside className="border-l bg-background"><Tabs defaultValue="configure" className="h-full gap-0"><TabsList variant="line" className="h-12 w-full justify-start border-b px-4"><TabsTrigger value="configure"><Settings2 />Configure</TabsTrigger><TabsTrigger value="insights"><History />Insights</TabsTrigger></TabsList><TabsContent value="configure" className="p-5">{selection === "trigger" ? <TriggerInspector draft={draft} setDraft={setDraft} disabled={!canEdit} /> : selectedStep ? <><StepInspector type={selectedStep.type} config={selectedStep.config} onChange={(config) => updateStep(selectedIndex, config)} mailboxes={mailboxes} members={memberOptions} disabled={!canEdit} />{errors[`step-${selectedIndex}`] ? <p className="mt-4 text-xs text-destructive">{errors[`step-${selectedIndex}`]}</p> : null}<div className="mt-6 flex gap-2 border-t pt-4"><Button variant="outline" size="sm" onClick={() => { if (!draft) return; const copy = { ...selectedStep, id: crypto.randomUUID(), config: { ...selectedStep.config } }; const steps = [...draft.steps]; steps.splice(selectedIndex + 1, 0, copy); setDraft({ ...draft, steps }); setSelection(copy.id!); }} disabled={!canEdit}><Copy />Duplicate</Button><Button variant="destructive" size="sm" onClick={() => removeStep(selectedIndex)} disabled={!canEdit}><Trash2 />Remove</Button></div></> : null}</TabsContent><TabsContent value="insights" className="p-5"><div className="grid grid-cols-2 gap-3"><Metric label="Active runs" value={draft.activeRuns || 0} /><Metric label="Completed" value={draft.completedRuns || 0} /><Metric label="Conversion" value="—" /><Metric label="Avg. duration" value="—" /></div><div className="mt-6"><p className="text-sm font-semibold">Recent activity</p><div className="mt-3 rounded-lg border border-dashed p-5 text-center"><History className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-xs text-muted-foreground">Run events and errors will appear here.</p></div></div></TabsContent></Tabs>{notice ? <div className="sticky bottom-0 border-t bg-background px-5 py-3 text-xs text-muted-foreground" role="status">{notice}</div> : null}</aside>
    </div>
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Preview · {draft.name}</DialogTitle><DialogDescription>Review the customer journey before turning it on.</DialogDescription></DialogHeader><div className="max-h-[60vh] space-y-2 overflow-auto rounded-lg bg-muted/30 p-4"><PreviewRow icon={Workflow} title="Trigger" detail={formatTrigger(draft.triggerType, draft.triggerConfig)} />{draft.steps.map((step, index) => <PreviewRow key={step.id || index} icon={stepMeta[step.type].icon} title={`${index + 1}. ${stepLabels[step.type]}`} detail={stepSummary(step.type, step.config)} />)}</div><DialogFooter showCloseButton><Button onClick={() => { setPreviewOpen(false); void persist("live"); }} disabled={!canEdit}><Play />Turn on flow</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={auditOpen} onOpenChange={setAuditOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-violet-600" />Flow audit</DialogTitle><DialogDescription>Checks configuration, safety, and customer experience.</DialogDescription></DialogHeader><div className="space-y-2"><AuditRow ok={Boolean(draft.name.trim())} label="Flow has a clear name" /><AuditRow ok={draft.steps.length > 0} label={`${draft.steps.length} action${draft.steps.length === 1 ? "" : "s"} configured`} /><AuditRow ok={draft.steps.some((step) => step.type === "wait")} label="Includes pacing between messages" /><AuditRow ok={!draft.steps.some((step) => step.type === "send_email") || draft.steps.some((step) => step.type === "send_email" && step.config.stopOnReply !== false)} label="Email steps stop when a customer replies" /><AuditRow ok={Boolean(audit?.success)} label={audit?.success ? "All required settings are complete" : "Some required settings need attention"} /></div><DialogFooter showCloseButton><Button onClick={() => { setAuditOpen(false); if (!audit?.success) setNotice("Review the highlighted step settings."); }}><Check />Review complete</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg border p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
function PreviewRow({ icon: Icon, title, detail }: { icon: typeof Mail; title: string; detail: string }) { return <div className="flex items-center gap-3 rounded-lg border bg-background p-3"><span className="grid size-8 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></span><div><p className="text-xs font-semibold">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{detail}</p></div></div>; }
function AuditRow({ ok, label }: { ok: boolean; label: string }) { return <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5"><span className={`grid size-6 place-items-center rounded-full ${ok ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}</span><span className="text-sm">{label}</span></div>; }
