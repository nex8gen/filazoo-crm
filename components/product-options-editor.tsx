"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, PlusCircle, Trash2 } from "lucide-react";
import type { ProductVariant } from "@/lib/types";
import { addVariantOption, removeVariantOption, reorderVariantOptions, updateVariantOption, variantOptionGroups, variantSwatch } from "@/lib/product-variants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import "./product-options-editor.css";

const recommended = ["Color", "Material", "Filament type", "Finish", "Diameter", "Weight", "Size", "Length", "Pack size"];
type ValueDraft = { id: string; originalValue: string | null; value: string };
type OptionDraft = { originalName: string | null; name: string; values: ValueDraft[] };
const key = (value: string) => value.trim().toLowerCase();
const valueDraft = (value = "", originalValue: string | null = null): ValueDraft => ({ id: crypto.randomUUID(), originalValue, value });

function SortableOptionRow({ id, disabled, label, children, className = "" }: { id: string; disabled: boolean; label: string; children: ReactNode; className?: string }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  return <div ref={setNodeRef} className={`product-option-sortable ${className}`} style={{ transform: CSS.Transform.toString(transform), transition }} data-dragging={isDragging || undefined}>
    <Button type="button" variant="ghost" size="icon-xs" className="product-option-drag" data-product-option-drag {...attributes} {...listeners} aria-label={label} disabled={disabled}><GripVertical /></Button>
    <div className="product-option-row-content">{children}</div>
  </div>;
}

export function ProductOptionsEditor({ variants, onChange, sku, disabled, onEditingChange }: {
  variants: ProductVariant[];
  onChange: (variants: ProductVariant[]) => void;
  sku: string;
  disabled: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const id = useId();
  const groups = variantOptionGroups(variants);
  const [draft, setDraft] = useState<OptionDraft | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [keepValue, setKeepValue] = useState("");
  const editing = draft !== null;
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const edits = draft?.values.filter((entry, index) => entry.value.trim() || index !== draft.values.length - 1) ?? [];
  const originalIndex = draft?.originalName ? groups.findIndex(group => group.name === draft.originalName) : -1;
  const retained = new Set(edits.flatMap(entry => entry.originalValue === null ? [] : [key(entry.originalValue)]));
  const existingOptions = (variant: ProductVariant) => variant.options ?? [{ name: "Color", value: variant.name }];
  const removed = originalIndex < 0 ? 0 : variants.filter(variant => !retained.has(key(existingOptions(variant)[originalIndex].value))).length;
  const templates = originalIndex < 0 ? variants.length : new Set(variants.map(variant => JSON.stringify(existingOptions(variant).filter((_, index) => index !== originalIndex).map(option => key(option.value))))).size;
  const added = originalIndex < 0 ? variants.length * Math.max(0, edits.length - 1) : templates * edits.filter(entry => entry.originalValue === null).length;
  const total = originalIndex < 0 ? variants.length * edits.length : variants.length - removed + added;

  function start(name: string, originalName: string | null = null) {
    const values = originalName ? groups.find(group => group.name === originalName)!.values.map(value => valueDraft(value, value)) : [];
    setDraft({ name, originalName, values: [...values, valueDraft()] });
    setPickerOpen(false); setError("");
  }
  function cancel() { setDraft(null); setError(""); }
  function done() {
    if (!draft || disabled) return;
    try {
      if (!edits.length || edits.some(entry => !entry.value.trim())) throw new Error("Enter at least one value, and fill in or remove empty values.");
      if (new Set(edits.map(entry => key(entry.value))).size !== edits.length) throw new Error("Each option value must be different.");
      const next = draft.originalName
        ? updateVariantOption(variants, draft.originalName, draft.name, edits, sku)
        : addVariantOption(variants, draft.name, edits.map(entry => entry.value), sku);
      onChange(next); cancel();
    } catch (error) { setError(error instanceof Error ? error.message : "Check the option and its values."); }
  }
  function editValue(entryId: string, value: string) {
    setDraft(current => {
      if (!current) return current;
      const values = current.values.map(entry => entry.id === entryId ? { ...entry, value } : entry);
      return { ...current, values };
    });
  }
  function commitNewValue() {
    setDraft(current => current?.values.at(-1)?.value.trim() ? { ...current, values: [...current.values, valueDraft()] } : current);
  }

  function editor() {
    if (!draft) return null;
    const values = draft.values.slice(0, -1);
    const placeholder = draft.values.at(-1)!;
    return <div className="product-option-editor" onKeyDown={event => {
      if ((event.target as HTMLElement).closest('[data-product-option-drag], [data-slot="select-content"], [data-slot="dialog-content"]')) return;
      if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") event.preventDefault();
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
    }}>
      <div className="space-y-2"><Label htmlFor={`${id}-name`}>Option name</Label><Input id={`${id}-name`} aria-label="Option name" autoFocus maxLength={50} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} disabled={disabled} /></div>
      <div className="space-y-2"><Label>Option values</Label>
        <DndContext id={`${id}-values`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          const from = values.findIndex(entry => entry.id === active.id), to = values.findIndex(entry => entry.id === over.id);
          if (from >= 0 && to >= 0) setDraft({ ...draft, values: [...arrayMove(values, from, to), placeholder] });
        }}>
          <SortableContext items={values.map(entry => entry.id)} strategy={verticalListSortingStrategy}>
            <div className="product-option-value-fields">{values.map((entry, index) => <SortableOptionRow key={entry.id} id={entry.id} label={`Reorder option value ${index + 1}`} disabled={disabled || values.length < 2} className="product-option-value-field">
              <Input aria-label={`Option value ${index + 1}`} value={entry.value} maxLength={120} onChange={event => editValue(entry.id, event.target.value)} disabled={disabled} />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove option value ${index + 1}`} disabled={disabled} onClick={() => setDraft({ ...draft, values: draft.values.filter(value => value.id !== entry.id) })}><Trash2 /></Button>
            </SortableOptionRow>)}</div>
          </SortableContext>
        </DndContext>
        <Input aria-label="Add another option value" placeholder="Add another value" className="product-option-new-value" value={placeholder.value} maxLength={120} onChange={event => editValue(placeholder.id, event.target.value)} onBlur={commitNewValue} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitNewValue(); } }} disabled={disabled} />
      </div>
      <div className="product-option-change-summary" role="status">{edits.length ? <>{total} {total === 1 ? "variant" : "variants"}{added > 0 ? ` · ${added} new, with inventory unset` : ""}</> : "Add at least one value."}</div>
      {removed > 0 ? <p className="text-xs text-destructive">{removed} {removed === 1 ? "variant will" : "variants will"} be removed when you choose Done.</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <div className="product-option-editor-actions">
        {draft.originalName ? <Button type="button" variant="destructive" size="sm" disabled={disabled || groups.length < 2} title={groups.length < 2 ? "Keep at least one product option" : "Delete option"} onClick={() => { setKeepValue(groups[originalIndex].values[0]); setDeleting(true); }}>Delete</Button> : <span />}
        <div className="flex gap-2"><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={cancel}>Cancel option</Button><Button type="button" size="sm" disabled={disabled} onClick={done}>Done</Button></div>
      </div>
    </div>;
  }

  return <div className="product-options-panel">
    <input type="hidden" name="productOptionsEditing" value={editing ? "true" : "false"} />
    <DndContext id={`${id}-options`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
      if (!over || active.id === over.id || editing || disabled) return;
      const from = groups.findIndex(group => group.name === active.id), to = groups.findIndex(group => group.name === over.id);
      if (from < 0 || to < 0) return;
      try { onChange(reorderVariantOptions(variants, arrayMove(groups.map(group => group.name), from, to))); } catch (error) { setError(error instanceof Error ? error.message : "Could not reorder options."); }
    }}>
      <SortableContext items={groups.map(group => group.name)} strategy={verticalListSortingStrategy}>
        {groups.map(group => <SortableOptionRow key={group.name} id={group.name} label={`Reorder ${group.name} option`} disabled={disabled || editing || groups.length < 2} className={`product-option-row${draft?.originalName === group.name ? " product-option-row-editing" : ""}`}>
          {draft?.originalName === group.name ? editor() : <Button type="button" variant="ghost" className="product-option-summary" aria-label={`Edit ${group.name} option`} aria-expanded={false} disabled={disabled || editing} onClick={() => start(group.name, group.name)}>
            <span className="product-option-name">{group.name}</span>
            <span className="product-option-values">{group.values.map(value => {
              const variant = variants.find(variant => existingOptions(variant).some(option => option.name === group.name && option.value === value));
              return <Badge key={value} variant="secondary" className={`product-color-chip product-option-value${key(group.name) === "color" ? " product-option-color-value" : ""}`}>
                {key(group.name) === "color" ? <span className="product-color-swatch" style={{ backgroundColor: variantSwatch({ name: value, colorHex: variant?.colorHex }) ?? "var(--muted)" }} /> : null}{value}
              </Badge>;
            })}</span>
          </Button>}
        </SortableOptionRow>)}
      </SortableContext>
    </DndContext>
    {draft && !draft.originalName ? <div className="product-option-row product-option-row-editing product-option-new-editor">{editor()}</div> : null}
    {!disabled && groups.length < 3 ? <Popover open={pickerOpen} onOpenChange={open => { setPickerOpen(open); if (open) setQuery(""); }}>
      <PopoverTrigger render={<Button type="button" size="sm" className="product-option-add" aria-label="Add another option" disabled={editing}><PlusCircle />Add another option</Button>} />
      <PopoverContent align="start" className="product-option-picker" aria-label="Choose product option">
        <Command shouldFilter={false}><CommandInput aria-label="Search product options" placeholder="Search options…" value={query} onValueChange={setQuery} />
          <CommandList><CommandGroup heading="Recommended">{recommended.filter(name => !groups.some(group => key(group.name) === key(name)) && key(name).includes(key(query))).map(name => <CommandItem key={name} value={name} onSelect={() => start(name)}>{name}</CommandItem>)}</CommandGroup>
            <CommandSeparator /><CommandItem value="custom" onSelect={() => start(query.trim())}><Plus />Create custom option{query.trim() ? ` “${query.trim()}”` : ""}</CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover> : null}
    {error && !editing ? <p role="alert" className="product-option-panel-error">{error}</p> : null}
    <Dialog open={deleting} onOpenChange={setDeleting}><DialogContent>
      <DialogHeader><DialogTitle>Delete {draft?.originalName} option?</DialogTitle><DialogDescription>Choose which value’s variants to keep. Other values’ variants will be removed from this product when you save. Their inventory is never merged into the remaining SKUs.</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor={`${id}-keep`}>Keep variants with {draft?.originalName}</Label><Select value={keepValue} onValueChange={value => { if (value) setKeepValue(value); }}><SelectTrigger id={`${id}-keep`} aria-label="Option value to keep" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{groups[originalIndex]?.values.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setDeleting(false)}>Cancel deletion</Button><Button type="button" variant="destructive" onClick={() => {
        if (!draft?.originalName) return;
        try { onChange(removeVariantOption(variants, draft.originalName, keepValue)); setDeleting(false); cancel(); } catch (error) { setError(error instanceof Error ? error.message : "Could not delete the option."); setDeleting(false); }
      }}>Delete option</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
