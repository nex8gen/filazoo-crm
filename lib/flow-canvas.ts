export type CanvasPoint = { x: number; y: number };
export type CanvasNode = CanvasPoint & { id: string; width: number; height: number };

export const CANVAS_NODE_WIDTH = 440;
export const CANVAS_START_X = 180;

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
