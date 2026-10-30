"use client";
import { ArrowRight, Workflow } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createFlowRecipe, flowRecipeOptions } from "@/lib/flow-recipes";
import { useLanguage } from "@/components/language-provider";
import type { FlowInput } from "@/lib/flows";

export function FlowStarterDialog({ onChoose, onOpenChange }: { onChoose: (flow: FlowInput) => void; onOpenChange: (open: boolean) => void }) {
  const { t } = useLanguage();
  return <Dialog open onOpenChange={onOpenChange}><DialogContent className="z-[70] max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Choose a starting point</DialogTitle><DialogDescription>Start with a complete journey, customize its audience and actions, then preview and test before turning it on.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">{flowRecipeOptions.map((recipe) => <button key={recipe.id} type="button" onClick={() => onChoose(createFlowRecipe(recipe.id))} className="group rounded-xl border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Badge variant="secondary">{t(recipe.trigger)}</Badge><div className="mt-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t(recipe.title)}</h3><ArrowRight className="size-4 text-muted-foreground group-hover:text-primary" /></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{t(recipe.description)}</p></button>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-xs text-muted-foreground">All starters open as drafts. Check the sender mailbox and audience before launch.</p><Button variant="outline" onClick={() => onChoose(createFlowRecipe("blank"))}><Workflow />Start from scratch</Button></div>
  </DialogContent></Dialog>;
}
