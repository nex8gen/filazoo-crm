"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Heading, ImageIcon, LayoutGrid, Minus, MousePointer2, Plus, Type, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PortalWebsiteBlock } from "@/lib/portal-design";
import { blockCanContainChildren, websiteElementTypes } from "@/lib/portal-website-blocks";

type TreeProps = {
  blocks: PortalWebsiteBlock[]; scope: string; selected?: string; parentPath?: number[]; canWrite: boolean; canAdd?: boolean;
  onSelect: (path: number[]) => void; onToggle: (path: number[]) => void; onDuplicate: (path: number[]) => void;
  onMove: (path: number[], index: number) => void; onAdd: (parent: number[]) => void;
};
const typeIcons = { heading: Heading, text: Type, image: ImageIcon, button: MousePointer2, video: Video, divider: Minus };
export function PortalElementTree(props: TreeProps) {
  return <div className="pb-element-tree" role="group" aria-label="Section elements">{props.blocks.map((block, index) => {
    const path = [...(props.parentPath ?? []), index];
    const key = path.join(".");
    const Icon = typeIcons[block.type as keyof typeof typeIcons] ?? LayoutGrid;
    const label = block.title || websiteElementTypes.find(item => item.value === block.type)?.label || "Element";
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
      <button type="button" className="pb-element-select" aria-pressed={props.selected === key} onClick={event => { event.preventDefault(); props.onSelect(path); }}><Icon /><span>{label}{!block.enabled && <small>Hidden</small>}</span></button>
      <div className="pb-element-row-actions"><button type="button" aria-label={`Move ${label} element up`} disabled={!props.canWrite || index === 0} onClick={() => props.onMove(path, index - 1)}><ArrowUp /></button><button type="button" aria-label={`Move ${label} element down`} disabled={!props.canWrite || index === props.blocks.length - 1} onClick={() => props.onMove(path, index + 1)}><ArrowDown /></button><button type="button" aria-label={`Duplicate ${label} element`} disabled={!props.canWrite || props.canAdd === false} onClick={() => props.onDuplicate(path)}><Copy /></button><button type="button" aria-label={`${block.enabled ? "Hide" : "Show"} ${label} element`} disabled={!props.canWrite} onClick={() => props.onToggle(path)}>{block.enabled ? <Eye /> : <EyeOff />}</button><GripVertical className="pb-element-grip" /></div>
    </div>;
    let content: ReactNode = row;
    if (blockCanContainChildren(block)) content = <details className="pb-element-container" open={props.selected === key || props.selected?.startsWith(`${key}.`) || undefined}><summary>{row}</summary><PortalElementTree {...props} blocks={block.children ?? []} parentPath={path} />{path.length < 3 && <Button type="button" variant="ghost" size="sm" className="pb-add-element" disabled={!props.canWrite || props.canAdd === false} onClick={() => props.onAdd(path)}><Plus />Add element</Button>}</details>;
    return <div key={block.id} className="pb-element-node">{content}</div>;
  })}</div>;
}
