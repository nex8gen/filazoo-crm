"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Bell, BellRing, Bot, Building2, CalendarClock, Check, CheckCheck, CircleCheck, ClipboardCheck, LoaderCircle, MoreHorizontal, Pencil, Plus, RotateCcw, UserRound, X } from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { activityTime, taskDueGroup, taskNotes, taskSource, type ActivityTask, type ActivityAlert } from "@/lib/task-activity";
import { flowConversationPath } from "@/lib/flow-engine";

const EmailAutoReplyControl = dynamic(() => import("@/components/email-auto-reply-control").then(mod => mod.EmailAutoReplyControl));

export function TaskItem({ task, now, pending, disabled, canManage, selected, compact = false, showAssignee = false, onComplete, onEdit, onCancel }: {
  task: ActivityTask; now: Date; pending?: boolean; disabled?: boolean; canManage?: boolean; selected?: boolean; compact?: boolean;
  onComplete?: () => void; onEdit?: () => void; onCancel?: () => void; showAssignee?: boolean;
}) {
  const source = taskSource(task), notes = taskNotes(task), group = taskDueGroup(task, now);
  const complete = task.status === "done", closed = complete || task.status === "cancelled";
  const displayDate = closed ? complete ? task.completed_at : null : task.due_at;
  const Icon = task.automation_id ? Bot : task.company_id ? Building2 : UserRound;
  const editable = canManage && !task.automation_id && !closed;
  return <article id={compact ? undefined : `task-${task.id}`} className={`group/task scroll-mt-24 px-4 py-4 sm:px-5 ${selected ? "bg-primary/[0.04] ring-1 ring-inset ring-primary/30" : "transition-colors hover:bg-muted/35"}`}>
    <div className="flex items-start gap-3">
      {compact ? <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-primary/10 bg-primary/5 text-primary"><ClipboardCheck className="size-3.5" /></span> : <button type="button" aria-label={`Mark complete: ${task.title}`} title={task.automation_id ? "Review this task using its AI controls" : "Mark complete"} disabled={!editable || disabled || pending} onClick={onComplete} className={`relative mt-0.5 grid size-[22px] before:absolute before:-inset-3 before:content-[''] shrink-0 place-items-center rounded-full border-[1.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default ${complete ? "border-primary bg-primary text-primary-foreground" : task.automation_id ? "border-primary/25 bg-primary/5 text-primary" : "border-muted-foreground/35 text-transparent enabled:hover:border-primary enabled:hover:bg-primary/10 enabled:hover:text-primary"}`}>
        {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : task.automation_id && !closed ? <Bot className="size-3" /> : <Check className="size-3.5" strokeWidth={2.5} />}
      </button>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {compact ? <Link href={`/tasks?task=${encodeURIComponent(task.id)}`} className="line-clamp-2 text-sm font-medium leading-5 hover:text-primary" data-no-translate>{task.title}</Link> : <p data-no-translate className={`text-sm font-medium leading-5 ${complete ? "text-muted-foreground line-through" : "text-foreground"}`}>{task.title}</p>}
          {task.priority === "high" ? <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-400"><span aria-hidden="true" className="h-2 w-0.5 rounded bg-current" /><span>High priority</span></span> : null}
          {task.automation_id ? <span className="rounded-md bg-primary/8 px-1.5 py-0.5 text-[10px] font-semibold text-primary">AI review</span> : null}
        </div>
        {!compact && notes ? <p data-no-translate className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{notes}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {showAssignee ? <span className="inline-flex items-center gap-1.5"><UserRound className="size-3" /><span data-no-translate>{task.assignee_name || "Workspace member"}</span></span> : null}
          <span className="inline-flex items-center gap-1.5"><Icon className="size-3" aria-hidden="true" /><span>{source}</span></span>
          <span className={`inline-flex items-center gap-1.5 ${group === "Overdue" ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}><CalendarClock className="size-3" aria-hidden="true" /><span>{group}</span>{displayDate && Number.isFinite(Date.parse(displayDate)) ? <time dateTime={displayDate} title={activityTime(displayDate)}>{new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(displayDate))}</time> : null}</span>
        </div>
        {!compact && task.automation_id && canManage && !closed ? <div className="mt-3 rounded-lg border border-primary/15 bg-background p-3"><EmailAutoReplyControl automationId={task.automation_id} /></div> : null}
      </div>
      {!compact && (editable || task.company_id) ? <DropdownMenu><DropdownMenuTrigger aria-label={`Task options: ${task.title}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-44">
        {editable ? <DropdownMenuItem disabled={disabled} onClick={onEdit}><Pencil />Edit task</DropdownMenuItem> : null}
        {task.company_id ? <DropdownMenuItem render={<Link href={`/companies/${task.company_id}`} />}><Building2 />Open company<ArrowUpRight className="ml-auto size-3" /></DropdownMenuItem> : null}
        {editable ? <DropdownMenuItem variant="destructive" disabled={disabled} onClick={onCancel}><X />Cancel task</DropdownMenuItem> : null}
      </DropdownMenuContent></DropdownMenu> : null}
      {compact ? <ArrowUpRight aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" /> : null}
    </div>
  </article>;
}

export function NotificationItem({ alert, pending, disabled, compact = false, onRead, onNavigate }: { alert: ActivityAlert; pending?: boolean; disabled?: boolean; compact?: boolean; onRead: () => void; onNavigate?: () => void }) {
  const taskAlert = Boolean(alert.task_id), review = /^(Shipping approval required:|AI reply needs review:)/i.test(alert.message);
  const Icon = review ? Bot : taskAlert ? ClipboardCheck : BellRing;
  const href = alert.task_id ? `/tasks?task=${encodeURIComponent(alert.task_id)}` : alert.include_thread_link && alert.conversation_id ? flowConversationPath(alert.conversation_id) : null;
  return <article className={`group/alert flex items-start gap-3 px-4 py-4 transition-colors sm:px-5 ${alert.read_at ? "hover:bg-muted/30" : "bg-primary/[0.025] hover:bg-primary/[0.045]"}`}>
    <div className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border ${alert.read_at ? "border-border/70 bg-muted/30 text-muted-foreground" : "border-primary/10 bg-primary/7 text-primary"}`}><Icon className="size-4" strokeWidth={1.6} aria-hidden="true" /></div>
    <div className="min-w-0 flex-1"><div className="mb-1 flex items-center gap-2"><span className={`text-[11px] font-medium ${alert.read_at ? "text-muted-foreground" : "text-primary"}`}>{review ? "AI review" : taskAlert ? "Task update" : "Workspace update"}</span>{!alert.read_at ? <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" /> : null}</div>
      {href ? <Link href={href} onClick={onNavigate} data-no-translate className={`block break-words text-sm leading-5 hover:text-primary ${compact ? "line-clamp-2" : "whitespace-pre-wrap"}`}>{alert.message}</Link> : <p data-no-translate className={`break-words text-sm leading-5 ${compact ? "line-clamp-2" : "whitespace-pre-wrap"}`}>{alert.message}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><time dateTime={alert.created_at}>{activityTime(alert.created_at)}</time>{!compact && href ? <Link href={href} onClick={onNavigate} className="inline-flex items-center gap-1 text-primary hover:underline">{taskAlert ? "Open task" : "Open conversation"}<ArrowUpRight className="size-3" /></Link> : null}{alert.read_at ? <span className="inline-flex items-center gap-1"><CheckCheck className="size-3" />Read</span> : null}</div>
    </div>
    {!alert.read_at ? <button type="button" onClick={onRead} disabled={disabled || pending} aria-label="Mark read" title="Mark read" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-primary/8 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}</button> : null}
  </article>;
}

export function ActivityEmptyState({ kind, filtered = false, completed = false, compact = false, canCreate, onCreate, onClear }: { kind: "tasks" | "notifications"; filtered?: boolean; completed?: boolean; compact?: boolean; canCreate?: boolean; onCreate?: () => void; onClear?: () => void }) {
  const Icon = kind === "notifications" ? Bell : completed ? CircleCheck : ClipboardCheck;
  return <div className={`flex flex-col items-center justify-center px-6 text-center ${compact ? "min-h-60 py-8" : "min-h-[340px] py-12 sm:min-h-[380px]"}`}>
    <div aria-hidden="true" className="relative mb-6 grid size-20 place-items-center">
      <div className="absolute inset-0 rounded-[24px] border border-primary/10 bg-primary/[0.035] -rotate-12" /><div className="relative grid size-16 place-items-center rounded-2xl border border-primary/15 bg-background shadow-sm"><Icon className="size-7 text-primary" strokeWidth={1.4} /></div><span className="absolute -right-1 bottom-0 grid size-6 place-items-center rounded-full border-[3px] border-background bg-primary text-primary-foreground"><Check className="size-3" strokeWidth={2.5} /></span>
    </div>
    <h3 className="text-base font-semibold tracking-tight">{filtered ? "Nothing matches this view" : kind === "notifications" ? "You're all caught up" : completed ? "Your progress starts here" : "A clear space for your next move"}</h3>
    <p className="mt-2 max-w-[330px] text-sm leading-6 text-muted-foreground">{filtered ? "Try another filter or a different search." : kind === "notifications" ? "Task updates, reminders and AI reviews will appear here when they need you." : completed ? "Completed tasks will appear here, so you can see what you've moved forward." : "Turn a customer follow-up or a small next step into a task. We'll keep it in view."}</p>
    {filtered && onClear ? <Button size="sm" variant="outline" className="mt-5" onClick={onClear}><RotateCcw className="size-3.5" />Clear filters</Button> : !completed && kind === "tasks" && canCreate ? <Button size="sm" className="mt-5" onClick={onCreate}><Plus className="size-3.5" />Create a task</Button> : null}
    {!compact && !filtered && !completed && kind === "tasks" ? <Link href="/companies" className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">Or follow up from a company profile<ArrowUpRight className="size-3" /></Link> : null}
    {!compact && kind === "notifications" && !filtered ? <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border bg-muted/25 px-3 py-1 text-[11px] text-muted-foreground"><ArrowDownLeft className="size-3" />Updates arrive automatically</span> : null}
  </div>;
}
