import { z } from "zod";
import { flowStatuses, stepTypes, triggerTypes, type FlowInput, type JsonConfig } from "./flows.ts";

const action = z.object({ id: z.string().min(1).max(200), type: z.enum(stepTypes), config: z.record(z.string(), z.json()) });
/** Editing copies allow incomplete settings. Publishing still uses flowInputSchema. */
export const flowEditorDefinitionSchema = z.object({
  name: z.string().max(200), status: z.enum(flowStatuses), triggerType: z.enum(triggerTypes),
  triggerConfig: z.record(z.string(), z.json()), steps: z.array(action).max(500),
}).superRefine((flow, context) => {
  let count = 0;
  const ids = new Set<string>();
  const inspect = (steps: unknown[], depth: number) => {
    if (depth > 5) { context.addIssue({ code: "custom", message: "A workflow supports up to five levels of splits." }); return; }
    for (const value of steps) {
      if (++count > 500) { context.addIssue({ code: "custom", message: "A workflow can contain up to 500 actions." }); return; }
      const parsed = action.safeParse(value);
      if (!parsed.success) { context.addIssue({ code: "custom", message: "Invalid action in workflow editing copy." }); return; }
      if (ids.has(parsed.data.id)) { context.addIssue({ code: "custom", message: "Every action needs a unique ID." }); return; }
      ids.add(parsed.data.id);
      if (parsed.data.type === "split" && Array.isArray(parsed.data.config.paths)) for (const path of parsed.data.config.paths) {
        if (!path || typeof path !== "object" || Array.isArray(path) || typeof path.id !== "string" || !path.id || typeof path.name !== "string" || !Array.isArray(path.steps) || ids.has(path.id)) {
          context.addIssue({ code: "custom", message: "Invalid split path in workflow editing copy." }); return;
        }
        ids.add(path.id); inspect(path.steps, depth + 1);
      }
    }
  };
  inspect(flow.steps, 0);
});
export const flowEditorSaveSchema = z.object({ flowId: z.uuid(), create: z.boolean(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), baseUpdatedAt: z.iso.datetime({ offset: true }).nullable(), flow: flowEditorDefinitionSchema });
export type FlowEditorSave = z.infer<typeof flowEditorSaveSchema>;
export type FlowEditingCopy = { definition: FlowInput; revision: number; baseUpdatedAt: string };
export function editingDefinition(value: z.infer<typeof flowEditorDefinitionSchema>): FlowInput {
  return value as FlowInput & { triggerConfig: JsonConfig };
}
