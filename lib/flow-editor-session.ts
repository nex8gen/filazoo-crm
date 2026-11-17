import { editFlowSiblings, flowActionLocations } from "./flow-tree.ts";
import type { FlowInput, JsonConfig } from "./flows.ts";

export type FlowEditorSnapshot = {
  selection: string;
  value: { triggerType: FlowInput["triggerType"]; triggerConfig: JsonConfig } | { config: JsonConfig } | null;
};

export type FlowPanelEditor = {
  hasChanges: () => boolean;
  snapshot?: () => { trigger?: Pick<FlowInput, "triggerType" | "triggerConfig">; config?: JsonConfig };
  prepare: () => { ok: true; trigger?: Pick<FlowInput, "triggerType" | "triggerConfig">; config?: JsonConfig } | { ok: false };
  reset: () => void;
};

/** JSONB may return object keys in a different order; array order is significant. */
export function flowEditorEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => flowEditorEqual(value, right[index]));
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length && keys.every(key => Object.hasOwn(b, key) && flowEditorEqual(a[key], b[key]));
}

export function flowEditorSnapshot(flow: FlowInput, selection: string): FlowEditorSnapshot {
  const action = flowActionLocations(flow.steps).find(item => item.action.id === selection)?.action;
  const value = selection === "trigger" ? { triggerType: flow.triggerType, triggerConfig: flow.triggerConfig } : action ? { config: action.config } : null;
  return { selection, value: value ? JSON.parse(JSON.stringify(value)) : null };
}

export function flowEditorChanged(flow: FlowInput, snapshot: FlowEditorSnapshot) {
  return !flowEditorEqual(flowEditorSnapshot(flow, snapshot.selection).value, snapshot.value);
}

/** Roll back this editor only. Keep changes to the name, order and other actions. */
export function restoreFlowEditor<T extends FlowInput>(flow: T, snapshot: FlowEditorSnapshot): T {
  const value = snapshot.value;
  if (value && "triggerType" in value) return { ...flow, ...JSON.parse(JSON.stringify(value)) };
  const location = flowActionLocations(flow.steps).find(item => item.action.id === snapshot.selection);
  if (!location) return flow;
  return { ...flow, steps: editFlowSiblings(flow.steps, location.path, (steps, index) => value && "config" in value
    ? steps.map((step, i) => i === index ? { ...step, config: JSON.parse(JSON.stringify(value.config)) } : step)
    : steps.filter((_, i) => i !== index)) };
}
