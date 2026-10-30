export type CanvasPoint = { x: number; y: number };
export type CanvasNode = CanvasPoint & { id: string; width: number; height: number };

export const CANVAS_NODE_WIDTH = 440;
export const CANVAS_START_X = 180;
export const MIN_FLOW_ZOOM = 0.001;

export function fitFlowCanvas(nodes: CanvasNode[], viewport: { width: number; height: number }) {
  if (!nodes.length) return { zoom: 1, pan: { x: 0, y: 0 } };
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  const zoom = Math.min(1, Math.max(MIN_FLOW_ZOOM, Math.min(Math.max(1, viewport.width - 120) / Math.max(1, right - left), Math.max(1, viewport.height - 100) / Math.max(1, bottom - top))));
  return { zoom, pan: { x: (viewport.width - (right - left) * zoom) / 2 - left * zoom, y: (viewport.height - (bottom - top) * zoom) / 2 - top * zoom } };
}

// Layout always follows execution order, including after inserting or moving a step.
export function layoutFlowNodes(stepIds: string[], heights: Record<string, number>, width = CANVAS_NODE_WIDTH) {
  const trigger: CanvasNode = { id: "__trigger", x: CANVAS_START_X, y: 64, width, height: heights.__trigger ?? 104 };
  let y = Math.max(240, trigger.y + trigger.height + 48);
  const steps = stepIds.map((id) => {
    const node: CanvasNode = { id, x: CANVAS_START_X, y, width, height: heights[id] ?? 72 };
    y += Math.max(144, node.height + 48);
    return node;
  });
  const end: CanvasNode = { id: "__end", x: CANVAS_START_X + (width - 162) / 2, y, width: 162, height: heights.__end ?? 34 };
  return { trigger, steps, end };
}

export function canvasPointFromClient(point: CanvasPoint, origin: CanvasPoint, pan: CanvasPoint, zoom: number): CanvasPoint {
  return { x: (point.x - origin.x - pan.x) / zoom, y: (point.y - origin.y - pan.y) / zoom };
}

export function flowInsertIndex(y: number, steps: CanvasNode[]) {
  const index = steps.findIndex((step) => y < step.y + step.height / 2);
  return index < 0 ? steps.length : index;
}

export function reorderFlowSteps<T>(steps: T[], from: number, to: number): T[] {
  if (from < 0 || from >= steps.length || to < 0 || to >= steps.length || from === to) return steps;
  const next = [...steps];
  const [step] = next.splice(from, 1);
  next.splice(to, 0, step!);
  return next;
}
