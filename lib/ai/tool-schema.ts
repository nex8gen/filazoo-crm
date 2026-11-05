import { z } from "zod";

/** Portable schema presentation; the original Zod parser remains authoritative.
 * Some function-calling providers reject an empty-string enum, even though it is
 * valid JSON Schema. Present that branch as a string instead of changing CRM data.
 */
export function portableToolSchema(schema: z.ZodType): Record<string, unknown> {
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const object = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    if ((Array.isArray(object.enum) && object.enum.includes("")) || object.const === "") {
      delete object.enum; delete object.const;
      object.type = "string";
      object.description = `${object.description ?? ""} An empty string is allowed; keep any other value within the CRM field's documented options.`.trim();
    }
    return object;
  }
  return visit(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })) as Record<string, unknown>;
}
