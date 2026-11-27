"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Heading, ImageIcon, LayoutGrid, Minus, MousePointer2, Plus, Trash2, Type, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortalWebsiteBlock } from "@/lib/portal-design";
import { blockCanContainChildren, websiteElementTypes } from "@/lib/portal-website-blocks";

type TreeProps = {
  blocks: PortalWebsiteBlock[]; scope: string; selected?: string; parentPath?: number[]; canWrite: boolean; canAdd?: boolean;
  onSelect: (path: number[]) => void; onToggle: (path: number[]) => void; onRemove: (path: number[]) => void;
  onMove: (path: number[], index: number) => void; onAdd: (parent: number[]) => void;
};
const typeIcons = { heading: Heading, text: Type, image: ImageIcon, button: MousePointer2, video: Video, divider: Minus };
export function PortalElementTree(props: TreeProps) {
  const [expansion, setExpansion] = useState<Record<string, boolean>>({});
  return <div className="pb-element-tree" role="group" aria-label="Section elements">{props.blocks.map((block, index) => {
    const path = [...(props.parentPath ?? []), index];
    const key = path.join(".");
    const Icon = typeIcons[block.type as keyof typeof typeIcons] ?? LayoutGrid;
    const label = block.title || websiteElementTypes.find(item => item.value === block.type)?.label || "Element";
    const container = blockCanContainChildren(block);
    const expanded = expansion[block.id] ?? (props.selected === key || Boolean(props.selected?.startsWith(`${key}.`)));
    const row = <div className={`pb-element-row ${props.selected === key ? "is-selected" : ""}`} draggable={props.canWrite}
      onDragStart={event => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-filazoo-block", JSON.stringify({ scope: props.scope, path })); }}
      onDragOver={event => { if (props.canWrite && event.dataTransfer.types.includes("application/x-filazoo-block")) event.preventDefault(); }}
      onDrop={event => {
        if (!props.canWrite) return;
        try {
          const source = JSON.parse(event.dataTransfer.getData("application/x-filazoo-block"));
          if (source.scope === props.scope && Array.isArray(source.path) && source.path.every((part: unknown) => Number.isInteger(part)) && source.path.length === path.length && source.path.slice(0, -1).join(".") === path.slice(0, -1).join(".")) {
            event.preventDefault(); event.stopPropagation(); props.onMove(source.path, index);
          }
        } catch {}
      }}>
      {container ? <button type="button" className="pb-section-expander" aria-label={`${expanded ? "Collapse" : "Expand"} ${label} elements`} aria-expanded={expanded} onClick={() => setExpansion(current => ({ ...current, [block.id]: !expanded }))}>{expanded ? <ChevronDown /> : <ChevronRight />}</button> : <span className="pb-element-indent" aria-hidden="true" />}
      <button type="button" className="pb-element-select" aria-pressed={props.selected === key} onClick={() => { if (container) setExpansion(current => ({ ...current, [block.id]: true })); props.onSelect(path); }}><Icon className="pb-row-type-icon" /><GripVertical className="pb-row-drag-handle" aria-hidden="true" /><span>{label}</span>{!block.enabled && <EyeOff className="pb-hidden-indicator" aria-label="Hidden" />}</button>
      <div className="pb-element-row-actions"><button type="button" title="Delete element" aria-label={`Delete ${label} element`} disabled={!props.canWrite} onClick={() => props.onRemove(path)}><Trash2 /></button><button type="button" title={block.enabled ? "Hide element" : "Show element"} aria-label={`${block.enabled ? "Hide" : "Show"} ${label} element`} disabled={!props.canWrite} onClick={() => props.onToggle(path)}>{block.enabled ? <Eye /> : <EyeOff />}</button></div>
    </div>;
    return <div key={block.id} className="pb-element-node">{row}{container && expanded && <div className="pb-element-children"><PortalElementTree {...props} blocks={block.children ?? []} parentPath={path} />{path.length < 3 && <Button type="button" variant="ghost" size="sm" className="pb-add-element" disabled={!props.canWrite || props.canAdd === false} onClick={() => props.onAdd(path)}><Plus />Add element</Button>}</div>}</div>;
  })}</div>;
}
