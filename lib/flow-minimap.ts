import type { CanvasNode } from "./flow-canvas.ts";

export const FLOW_MINIMAP_TARGETS = '[data-flow-card], [data-flow-path-header], .wf-trigger-card, [data-flow-node-id="__end"]';

export type FlowMinimap = {
  nodes: (CanvasNode & { kind: string })[];
  connectors: { path: string; x: number; y: number }[];
};

/** Measure card surfaces, never the split wrappers that enclose entire subtrees. */
export function measureFlowMinimap(content: HTMLElement): FlowMinimap {
  const origin = content.getBoundingClientRect();
  const scale = origin.width / content.offsetWidth;
  if (!Number.isFinite(scale) || scale <= 0) return { nodes: [], connectors: [] };
  const bounds = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: (rect.left - origin.left) / scale, y: (rect.top - origin.top) / scale, width: rect.width / scale, height: rect.height / scale };
  };
  const nodes = [...content.querySelectorAll<HTMLElement>(FLOW_MINIMAP_TARGETS)].map((element, index) => ({
    ...bounds(element),
    id: element.matches('[data-flow-path-header]') ? `path:${element.closest<HTMLElement>('[data-flow-branch-id]')?.dataset.flowBranchId ?? index}`
      : element.closest<HTMLElement>('[data-flow-action-id], [data-flow-node-id]')?.dataset.flowActionId
        ?? element.closest<HTMLElement>('[data-flow-node-id]')?.dataset.flowNodeId ?? `node:${index}`,
    kind: element.dataset.flowKind ?? (element.matches('.wf-trigger-card') ? 'trigger' : element.matches('[data-flow-path-header]') ? 'path' : 'end'),
  })).filter(node => node.width > 0 && node.height > 0);
  const connectors = [...content.querySelectorAll<SVGPathElement>('.wf-connector-stroke')].flatMap(element => {
    const svg = element.closest('svg');
    const path = element.getAttribute('d');
    if (!svg || !path) return [];
    const { x, y } = bounds(svg);
    return [{ path, x, y }];
  });
  // Branch sequences use CSS lines between cards in addition to SVG split/join rails.
  for (const element of content.querySelectorAll<HTMLElement>('.wf-branch-insert, .wf-branch-tail.wf-connector-line')) {
    const { x, y, width, height } = bounds(element);
    connectors.push({ path: `M ${x + width / 2} ${y} v ${height}`, x: 0, y: 0 });
  }
  return { nodes, connectors };
}

export function flowMinimapBounds(nodes: CanvasNode[]) {
  if (!nodes.length) return { x: 0, y: 0, width: 800, height: 600 };
  const left = Math.min(...nodes.map(node => node.x)) - 60;
  const top = Math.min(...nodes.map(node => node.y)) - 60;
  const contentWidth = Math.max(...nodes.map(node => node.x + node.width)) - left + 60;
  const contentHeight = Math.max(...nodes.map(node => node.y + node.height)) - top + 60;
  const width = Math.max(contentWidth, contentHeight * 4 / 3);
  const height = width * 3 / 4;
  return { x: left - (width - contentWidth) / 2, y: top - (height - contentHeight) / 2, width, height };
}
