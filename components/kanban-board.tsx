"use client";

import { useState } from "react";
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
import type { Company, PipelineStageValue } from "@/lib/types";
import type { BdSalesManager } from "@/lib/data/members";

type PipelineCard = { id: string; company: string; country: string; ownerId: string | null; ownerName: string; ownerInitials: string; stage: PipelineStageValue };

const stages: { id: PipelineStageValue; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "replied", label: "Replied" },
  { id: "interested", label: "Interested" },
  { id: "big_order", label: "Big order" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const stageByLabel = Object.fromEntries(stages.map((stage) => [stage.label, stage.id])) as Record<Company["stage"], PipelineStageValue>;

export function KanbanBoard({ companies, managers, canWrite, canAssign, query = "", stageFilter = "all" }: { companies: Company[]; managers: BdSalesManager[]; canWrite: boolean; canAssign: boolean; query?: string; stageFilter?: string }) {
  const [cards, setCards] = useState<PipelineCard[]>(() => companies.map((company) => ({ id: company.id, company: company.name, country: company.country, ownerId: company.ownerId, ownerName: company.ownerName, ownerInitials: company.ownerInitials, stage: stageByLabel[company.stage] })));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeCard = cards.find((card) => card.id === active.id);
    const overCard = cards.find((card) => card.id === over.id);
    const nextStage = overCard?.stage ?? stages.find((stage) => stage.id === over.id)?.id;
    if (!activeCard || !nextStage || activeCard.stage === nextStage) return;
    const previousStage = activeCard.stage;
    setCards((current) => current.map((card) => card.id === activeCard.id ? { ...card, stage: nextStage } : card));
    const result = await updatePipelineStage(activeCard.id, nextStage);
    if (result?.error) {
      setCards((current) => current.map((card) => card.id === activeCard.id ? { ...card, stage: previousStage } : card));
      toast.error(result.error);
      return;
    }
    toast.success("Pipeline stage updated.");
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleCards = cards.filter((card) => (stageFilter === "all" || card.stage === stageFilter) && `${card.company} ${card.country}`.toLowerCase().includes(normalizedQuery));

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="flex min-w-0 gap-4 overflow-x-auto pb-4">
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
          <span className="truncate text-[10px] text-muted-foreground">{card.ownerName}</span>
          {canAssign ? <Select value={card.ownerId || "unassigned"} onValueChange={async (value) => { const ownerId = value === "unassigned" ? null : value; const previous = card.ownerId; onOwnerChanged(card.id, ownerId); const result = await assignPipelineOwner(card.id, ownerId); if (result?.error) { onOwnerChanged(card.id, previous); toast.error(result.error); } else toast.success(result?.success || "Lead owner updated."); }}><SelectTrigger size="sm" className="h-7 w-24 text-[10px]" aria-label={`Assign ${card.company}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{managers.map((manager) => <SelectItem key={manager.id} value={manager.id}>{manager.name}</SelectItem>)}</SelectContent></Select> : <Avatar className="size-6" title={card.ownerName}><AvatarFallback className="bg-muted text-[10px]">{card.ownerInitials}</AvatarFallback></Avatar>}
        </div>
      </CardContent>
    </Card>
  );
}
