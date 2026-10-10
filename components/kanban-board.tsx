"use client";

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MapPin } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { pipelineCards as initialCards, type PipelineCard, type PipelineStage } from "@/lib/fake-data";

const stages: { id: PipelineStage; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "replied", label: "Replied" },
  { id: "interested", label: "Interested" },
  { id: "big-order", label: "Big order" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export function KanbanBoard() {
  const [cards, setCards] = useState(initialCards);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeCard = cards.find((card) => card.id === active.id);
    const overCard = cards.find((card) => card.id === over.id);
    const nextStage = (overCard?.stage ?? stages.find((stage) => stage.id === over.id)?.id) as PipelineStage | undefined;
    if (!activeCard || !nextStage || activeCard.stage === nextStage) return;
    setCards((current) => current.map((card) => card.id === activeCard.id ? { ...card, stage: nextStage } : card));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="flex min-w-0 gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const stageCards = cards.filter((card) => card.stage === stage.id);
          return <KanbanColumn key={stage.id} stage={stage} cards={stageCards} />;
        })}
      </div>
    </DndContext>
  );
}

function KanbanColumn({ stage, cards }: { stage: { id: PipelineStage; label: string }; cards: PipelineCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section ref={setNodeRef} className={`w-64 shrink-0 rounded-lg border bg-muted/30 p-3 transition-colors duration-150 ${isOver ? "border-primary bg-brand-soft" : ""}`}>
      <header className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${["interested", "big-order", "won"].includes(stage.id) ? "bg-primary" : "bg-muted-foreground/40"}`} /><h2 className="text-xs font-medium">{stage.label}</h2></div><Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-xs">{cards.length}</Badge></header>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {cards.map((card) => <SortableCard key={card.id} card={card} />)}
          {cards.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">Drop a company here</div>}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ card }: { card: PipelineCard }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ? "transform 150ms ease" : undefined }}
      className={`cursor-grab py-0 shadow-none active:cursor-grabbing ${isDragging ? "opacity-50" : ""}`}
      {...attributes}
      {...listeners}
    >
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{card.company}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" />{card.country}</p></div><GripVertical className="size-4 shrink-0 text-muted-foreground" /></div>
        <div className="flex items-center justify-between border-t pt-3"><span className="text-xs font-medium">{card.value}</span><Avatar className="size-6"><AvatarFallback className="bg-muted text-[10px]">{card.owner}</AvatarFallback></Avatar></div>
      </CardContent>
    </Card>
  );
}
