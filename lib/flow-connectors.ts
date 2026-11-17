import type { CanvasPoint } from "./flow-canvas.ts";

/** Rounded orthogonal routing stays inside the existing connector gap. */
export function flowConnectorPath(from: CanvasPoint, to: CanvasPoint, radius = 20): string {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx || !dy) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const bend = Math.max(0, Math.min(radius, Math.abs(dx) / 2, Math.abs(dy) / 2));
  const middle = (from.y + to.y) / 2;
  const horizontal = Math.sign(dx) * bend, vertical = Math.sign(dy) * bend;
  return `M ${from.x} ${from.y} L ${from.x} ${middle - vertical} Q ${from.x} ${middle} ${from.x + horizontal} ${middle} L ${to.x - horizontal} ${middle} Q ${to.x} ${middle} ${to.x} ${middle + vertical} L ${to.x} ${to.y}`;
}
