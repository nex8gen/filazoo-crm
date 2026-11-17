"use client";

import { AlertTriangle } from "lucide-react";
import type { FlowConnectorHealth } from "@/lib/flow-connector-health";

export function FlowHealthNotice({ health, onReview }: { health: FlowConnectorHealth; onReview: () => void }) {
  if (health.state === "idle" || health.state === "live" || health.message === "Checking workflow health") return null;
  return <div className="wf-health-notice" data-health={health.state} role="status">
    <AlertTriangle aria-hidden="true" />
    <div><strong>{health.state === "error" ? "Workflow needs attention" : "Workflow health is unverified"}</strong><p>{health.message}</p></div>
    <button type="button" onClick={onReview}>Review checks</button>
  </div>;
}
