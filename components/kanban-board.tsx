"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, type DragEndEvent, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MapPin } from "lucide-react";
import { toast } from "sonner";
import { assignPipelineOwner, updatePipelineStage } from "@/app/crm-actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pipelineStageLabels, pipelineStageValues, type Company, type PipelineStageValue } from "@/lib/types";
import type { BdSalesManager } from "@/lib/data/members";

type PipelineCard = { id: string; company: string; country: string; ownerId: string | null; ownerName: string; ownerInitials: string; stage: PipelineStageValue };

const stages: { id: PipelineStageValue; label: string }[] = pipelineStageValues.map((id) => ({ id, label: pipelineStageLabels[id] }));

const stageByLabel = Object.fromEntries(stages.map((stage) => [stage.label, stage.id])) as Record<Company["stage"], PipelineStageValue>;

async function saveOwner(companyId: string, ownerId: string | null | undefined) {
  if (ownerId === undefined) return { error: "Choose a manager or Unassigned." };
  try {
    return await assignPipelineOwner(companyId, ownerId);
  } catch {
    return { error: "Unable to update the lead owner. Please retry." };
  }
}

export function KanbanBoard({ companies, managers, canWrite, canAssign, query = "", stageFilter = "all" }: { companies: Company[]; managers: BdSalesManager[]; canWrite: boolean; canAssign: boolean; query?: string; stageFilter?: string }) {
  const [cards, setCards] = useState<PipelineCard[]>(() => companies.map((company) => ({ id: company.id, company: company.name, country: company.country, ownerId: company.ownerId, ownerName: company.ownerName, ownerInitials: company.ownerInitials, stage: stageByLabel[company.stage] })));
  const [previousCompanies, setPreviousCompanies] = useState(companies);
  if (previousCompanies !== companies) {
    setPreviousCompanies(companies);
    setCards(companies.map((company) => ({ id: company.id, company: company.name, country: company.country, ownerId: company.ownerId, ownerName: company.ownerName, ownerInitials: company.ownerInitials, stage: stageByLabel[company.stage] })));
  }
  const moving = useRef(new Set<string>());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [mobileStage, setMobileStage] = useState<PipelineStageValue>(stages[0].id);

  async function changeStage(id: string, nextStage: PipelineStageValue) {
    const card = cards.find((item) => item.id === id);
    if (!card || !canWrite || card.stage === nextStage || moving.current.has(id)) return;
    moving.current.add(id);
    const previousStage = card.stage;
    setCards((current) => current.map((item) => item.id === id ? { ...item, stage: nextStage } : item));
    try {
      const result = await updatePipelineStage(id, nextStage);
      if (result?.error) {
        setCards((current) => current.map((item) => item.id === id ? { ...item, stage: previousStage } : item));
        toast.error(result.error);
      } else toast.success("Pipeline stage updated.");
    } catch {
      setCards((current) => current.map((item) => item.id === id ? { ...item, stage: previousStage } : item));
      toast.error("Unable to update the pipeline stage. Please retry.");
    } finally {
      moving.current.delete(id);
    }
  }

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeCard = cards.find((card) => card.id === active.id);
    const overCard = cards.find((card) => card.id === over.id);
    const nextStage = overCard?.stage ?? stages.find((stage) => stage.id === over.id)?.id;
    if (!activeCard || !nextStage || activeCard.stage === nextStage) return;
    await changeStage(activeCard.id, nextStage);
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCards = cards.filter((card) => (stageFilter === "all" || card.stage === stageFilter) && `${card.company} ${card.country}`.toLowerCase().includes(normalizedQuery));

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="space-y-3 md:hidden">
        <label className="flex flex-col gap-2 text-sm font-medium">Pipeline stage
          <Select value={stageFilter === "all" ? mobileStage : stageFilter} disabled={stageFilter !== "all"} onValueChange={(value) => { if (value === null) return; return setMobileStage(value as PipelineStageValue); }}><SelectTrigger className="w-full rounded-lg border bg-background px-3 py-2"><SelectValue /></SelectTrigger><SelectContent>{stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label} ({visibleCards.filter((card) => card.stage === stage.id).length})</SelectItem>)}</SelectContent></Select>
        </label>
        <p className="text-xs text-muted-foreground">Open a company or use Move to stage to update a deal.</p>
        {visibleCards.filter((card) => card.stage === (stageFilter === "all" ? mobileStage : stageFilter)).map((card) => <Card key={card.id} className="gap-3 p-4 shadow-none">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={`/companies/${card.id}`} className="text-sm font-semibold text-primary hover:underline">{card.company}</Link><p className="mt-1 text-xs text-muted-foreground">{card.country}</p></div><Avatar className="size-8" title={card.ownerName}><AvatarFallback className="text-xs">{card.ownerInitials}</AvatarFallback></Avatar></div>
          <p className="text-xs text-muted-foreground">Owner: {card.ownerName}</p>
          {canWrite ? <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">Move to stage<Select value={card.stage} onValueChange={(value) => { if (value === null) return; return void changeStage(card.id, value as PipelineStageValue); }}><SelectTrigger aria-label={`Move ${card.company} to stage`} className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"><SelectValue /></SelectTrigger><SelectContent>{stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}</SelectContent></Select></label> : null}
          {canAssign ? <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">Assigned manager<Select value={card.ownerId || "unassigned"} onValueChange={async (value) => { if (value === null) return;  const ownerId = value === "unassigned" ? null : value; const result = await saveOwner(card.id, ownerId); if (result?.error) toast.error(result.error); else { setCards((current) => current.map((item) => item.id === card.id ? { ...item, ownerId, ownerName: managers.find((manager) => manager.id === ownerId)?.name || "Unassigned", ownerInitials: ownerId ? initials(managers.find((manager) => manager.id === ownerId)?.name || "BD") : "—" } : item)); toast.success("Lead owner updated."); }  }}><SelectTrigger aria-label={`Assign ${card.company}`} className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.name}</SelectItem>)}</SelectContent></Select></label> : null}
        </Card>)}
        {!visibleCards.some((card) => card.stage === (stageFilter === "all" ? mobileStage : stageFilter)) ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No companies in this stage.</p> : null}
      </div>
      <div className="hidden min-w-0 gap-4 overflow-x-auto pb-4 md:flex">
        {stages.filter((stage) => stageFilter === "all" || stage.id === stageFilter).map((stage) => <KanbanColumn key={stage.id} stage={stage} cards={visibleCards.filter((card) => card.stage === stage.id)} managers={managers} canWrite={canWrite} canAssign={canAssign} onOwnerChanged={(id, ownerId) => setCards((current) => current.map((card) => card.id === id ? { ...card, ownerId, ownerName: managers.find((manager) => manager.id === ownerId)?.name || "Unassigned", ownerInitials: ownerId ? initials(managers.find((manager) => manager.id === ownerId)?.name || "BD") : "—" } : card))} />)}
      </div>
    </DndContext>
  );
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }

function KanbanColumn({ stage, cards, managers, canWrite, canAssign, onOwnerChanged }: { stage: { id: PipelineStageValue; label: string }; cards: PipelineCard[]; managers: BdSalesManager[]; canWrite: boolean; canAssign: boolean; onOwnerChanged: (id: string, ownerId: string | null) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section ref={setNodeRef} className={`w-64 shrink-0 rounded-lg border bg-muted/30 p-3 transition-colors duration-150 ${isOver ? "border-primary bg-brand-soft" : ""}`}>
      <header className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${["interested", "big_order", "won"].includes(stage.id) ? "bg-primary" : "bg-muted-foreground/40"}`} /><h2 className="text-xs font-medium">{stage.label}</h2></div><Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-xs">{cards.length}</Badge></header>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">{cards.map((card) => <SortableCard key={card.id} card={card} managers={managers} canWrite={canWrite} canAssign={canAssign} onOwnerChanged={onOwnerChanged} />)}{cards.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">{canWrite ? "Drop a company here" : "No companies"}</div>}</div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ card, managers, canWrite, canAssign, onOwnerChanged }: { card: PipelineCard; managers: BdSalesManager[]; canWrite: boolean; canAssign: boolean; onOwnerChanged: (id: string, ownerId: string | null) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !canWrite });
  return (
    <Card ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition: transition ? "transform 150ms ease" : undefined }} className={`${canWrite ? "cursor-grab active:cursor-grabbing" : ""} py-0 shadow-none ${isDragging ? "opacity-50" : ""}`} {...attributes} {...listeners}>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{card.company}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" />{card.country}</p></div><GripVertical className="size-4 shrink-0 text-muted-foreground" /></div>
        <div className="flex items-center justify-between gap-2 border-t pt-3" onPointerDown={(event) => event.stopPropagation()}>
          <span className="truncate text-xs text-muted-foreground">{card.ownerName}</span>
          {canAssign ? <Select value={card.ownerId || "unassigned"} onValueChange={async (value) => { const ownerId = value === "unassigned" ? null : value; const previous = card.ownerId; onOwnerChanged(card.id, ownerId); const result = await saveOwner(card.id, ownerId); if (result?.error) { onOwnerChanged(card.id, previous); toast.error(result.error); } else toast.success(result?.success || "Lead owner updated."); }}><SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label={`Assign ${card.company}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.name}</SelectItem>)}</SelectContent></Select> : <Avatar className="size-6" title={card.ownerName}><AvatarFallback className="bg-muted text-xs">{card.ownerInitials}</AvatarFallback></Avatar>}
        </div>
      </CardContent>
    </Card>
  );
}
