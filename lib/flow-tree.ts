import type { FlowInput, JsonConfig } from "./flows.ts";

type Action = FlowInput["steps"][number];
export const FLOW_BRANCH_GAP = 48;
export type FlowDropTarget = { branchId: string | null; index: number };
export type FlowPath = { id: string; name: string; condition: JsonConfig | null; steps: Action[] };
export function flowPaths(config: JsonConfig): FlowPath[] {
  return (Array.isArray(config.paths) ? config.paths : []) as unknown as FlowPath[];
}

export function flowActionLocations(steps: Action[], prefix: number[] = []): Array<{ action: Action; path: number[] }> {
  return steps.flatMap((action, index) => {
    const path = [...prefix, index];
    return [{ action, path }, ...(action.type === "split" ? flowPaths(action.config).flatMap((branch, branchIndex) => flowActionLocations(branch.steps, [...path, branchIndex])) : [])];
  });
}

/** The same action label can occur in many paths; retain its full visible ancestry. */
export function flowActionTrail(steps: Action[], path: number[]): string[] {
  if (!path.length || path.length % 2 !== 1 || path.some((value) => !Number.isInteger(value) || value < 0)) return [];
  let siblings = steps;
  const trail: string[] = [];
  for (let cursor = 0; cursor < path.length - 1; cursor += 2) {
    const action = siblings[path[cursor]];
    if (action?.type !== "split") return [];
    const branch = flowPaths(action.config)[path[cursor + 1]];
    if (!branch) return [];
    trail.push(String(action.config.name || "Split"), branch.name);
    siblings = branch.steps;
  }
  return siblings[path.at(-1)!] ? trail : [];
}

/** Edit siblings at a source path without mutating other branches or the saved definition. */
export function editFlowSiblings(steps: Action[], path: number[], edit: (siblings: Action[], index: number) => Action[]): Action[] {
  const [index, branchIndex, ...rest] = path;
  if (path.length === 1) return edit([...steps], index);
  return steps.map((action, actionIndex) => actionIndex !== index ? action : {
    ...action,
    config: { ...action.config, paths: flowPaths(action.config).map((branch, i) => i !== branchIndex ? branch : {
      ...branch, steps: editFlowSiblings(branch.steps, rest, edit),
    }) as unknown as JsonConfig["paths"] },
  });
}

export function flowNodeWidth(action: Action): number {
  return action.type === "split" ? Math.max(440, flowPaths(action.config).reduce((sum, branch) => sum + Math.max(360, ...branch.steps.map(flowNodeWidth)), 0) + Math.max(0, flowPaths(action.config).length - 1) * FLOW_BRANCH_GAP) : 360;
}

function dropContainer(steps: Action[], branchId: string | null) {
  if (branchId === null) return { steps, prefix: [] as number[] };
  for (const location of flowActionLocations(steps)) {
    if (location.action.type !== "split") continue;
    const paths = flowPaths(location.action.config);
    const index = paths.findIndex((path) => path.id === branchId);
    if (index >= 0) return { steps: paths[index].steps, prefix: [...location.path, index] };
  }
  return null;
}

/** Stable branch IDs survive removal of an earlier root/branch action. */
export function dropFlowAction(steps: Action[], target: FlowDropTarget, input: { action: Action } | { actionId: string }): { steps: Action[]; action?: Action; error?: string } {
  const destination = dropContainer(steps, target.branchId);
  if (!destination || !Number.isInteger(target.index) || target.index < 0 || target.index > destination.steps.length) return { steps, error: "Choose an action connector inside the destination path." };
  const source = "actionId" in input ? flowActionLocations(steps).find(({ action }) => action.id === input.actionId) : null;
  const action = "action" in input ? input.action : source?.action;
  if (!action) return { steps, error: "The dragged action no longer exists." };
  if (source && action.type === "split" && flowActionLocations([action]).some((item) => item.action.type === "split" && flowPaths(item.action.config).some((path) => path.id === target.branchId))) return { steps, error: "A split cannot be moved into its own paths." };
  const sameContainer = source && source.path.slice(0, -1).join(".") === destination.prefix.join(".");
  if (target.branchId !== null && destination.steps.length >= 25 && !sameContainer) return { steps, error: "A path can contain up to 25 actions." };
  if (!source && flowActionLocations(steps).length + flowActionLocations([action]).length > 500) return { steps, error: "A workflow can contain up to 500 actions across its paths." };
  let index = target.index;
  if (sameContainer && source.path.at(-1)! < index) index--;
  if (sameContainer && source.path.at(-1) === index) return { steps, action };
  const removed = source ? editFlowSiblings(steps, source.path, (siblings, at) => siblings.filter((_, i) => i !== at)) : steps;
  const currentDestination = dropContainer(removed, target.branchId);
  if (!currentDestination) return { steps, error: "Choose an action connector inside the destination path." };
  const result = editFlowSiblings(removed, [...currentDestination.prefix, index], (siblings, at) => { siblings.splice(at, 0, action); return siblings; });
  if (flowActionLocations(result).some((item) => item.path.length > 11 || (item.action.type === "split" && item.path.length > 9))) return { steps, error: "A workflow supports up to five levels of splits." };
  return { steps: result, action };
}
