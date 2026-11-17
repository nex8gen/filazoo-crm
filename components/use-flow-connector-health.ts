"use client";

import { useEffect, useState } from "react";
import { flowInputSchema, type FlowInput } from "@/lib/flows";
import type { FlowCheckResult } from "@/lib/flow-check";
import { flowConnectorHealth, readFlowRuntimeIssues, type FlowHealthEvidence } from "@/lib/flow-connector-health";

/** Refresh only while the saved live canvas is visible. Never execute an action. */
export function useFlowConnectorHealth(flow: FlowInput | null, flowId: string | null, dependencyIssue?: string, saved = true) {
  const definition = flow ? JSON.stringify({ name: flow.name, triggerType: flow.triggerType, triggerConfig: flow.triggerConfig, status: flow.status, steps: flow.steps }) : "";
  const key = `${flowId}:${definition}`;
  const [snapshot, setSnapshot] = useState<{ key: string; evidence: FlowHealthEvidence } | null>(null);
  useEffect(() => {
    if (!flowId || !definition || !saved) return;
    const parsed = flowInputSchema.safeParse(JSON.parse(definition));
    if (!parsed.success || parsed.data.status !== "live") return;
    const checkedFlow = parsed.data;
    const savedId = flowId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let busy = false;
    async function refresh() {
      if (busy || controller.signal.aborted) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(refresh, 60_000); return; }
      busy = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      const [check, runtime] = await Promise.allSettled([
        fetch("/api/flows/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flow: checkedFlow, flowId: savedId }), cache: "no-store", signal }).then(async response => {
          const result = await response.json();
          if (!response.ok || !result.ok || !Array.isArray(result.checks)) throw new Error(result.error || "Connection health could not be verified");
          return result as FlowCheckResult;
        }),
        readFlowRuntimeIssues(savedId, signal),
      ]);
      if (!controller.signal.aborted) {
        const evidence: FlowHealthEvidence = { readError: "" };
        if (check.status === "fulfilled") evidence.checks = check.value;
        if (runtime.status === "fulfilled") { evidence.runtimeIssues = runtime.value; evidence.runtimeIssue = runtime.value[0]?.message ?? null; }
        const rejected = [check, runtime].find(result => result.status === "rejected");
        if (rejected?.status === "rejected") evidence.readError = rejected.reason instanceof Error ? rejected.reason.message : "Workflow health could not be verified";
        // Keep a known blocker red until a successful refresh confirms recovery.
        setSnapshot(current => ({ key, evidence: { ...(current?.key === key ? current.evidence : {}), ...evidence } }));
        timer = setTimeout(refresh, 60_000);
      }
      busy = false;
    }
    timer = setTimeout(refresh, 600);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [definition, flowId, key, saved]);
  return flowConnectorHealth(flow, snapshot?.key === key ? snapshot.evidence : undefined, dependencyIssue, saved);
}
