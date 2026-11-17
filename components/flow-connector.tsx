"use client";

import { useId, useSyncExternalStore } from "react";
import type { CanvasPoint } from "@/lib/flow-canvas";
import { flowConnectorPath } from "@/lib/flow-connectors";
import type { FlowConnectionState } from "@/lib/flow-connector-health";

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  preference?.addEventListener("change", onChange);
  return () => preference?.removeEventListener("change", onChange);
}
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const serverMotionPreference = () => true;

/** One stroke treatment for main steps, branch splits, and branch joins. */
export function FlowConnector({ from, to, state = "idle", actionId }: { from: CanvasPoint; to: CanvasPoint; state?: FlowConnectionState; actionId?: string }) {
  const gradientId = `wf-connector-${useId().replaceAll(":", "")}`;
  const path = flowConnectorPath(from, to);
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, serverMotionPreference);
  const dx = to.x - from.x, dy = to.y - from.y;
  const animated = state === "live" && !reducedMotion && Boolean(dx || dy);
  return <g className="wf-connector" data-flow-health={state} data-flow-connector-action={actionId} data-flow-animated={animated ? "" : undefined}>
    <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
      <stop offset="0%" stopColor="var(--wf-connector-color)" />
      <stop offset="16%" stopColor="var(--wf-connector-color)" />
      <stop offset="34%" stopColor="color-mix(in srgb, var(--wf-connector-accent) 30%, var(--wf-connector-color))" />
      <stop offset="56%" stopColor="var(--wf-connector-accent)" />
      <stop offset="76%" stopColor="var(--wf-connector-color)" />
      <stop offset="100%" stopColor="var(--wf-connector-color)" />
      {animated ? <animateTransform attributeName="gradientTransform" type="translate" values={`${-dx} ${-dy}; ${dx} ${dy}`} dur="3.8s" repeatCount="indefinite" /> : null}
    </linearGradient></defs>
    <path className="wf-connector-stroke" d={path} fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </g>;
}
