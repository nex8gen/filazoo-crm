import { z } from "zod";

/** Portable schema presentation; the original Zod parser remains authoritative.
 * Some function-calling providers reject an empty-string enum, even though it is
 * valid JSON Schema. Present that branch as a string instead of changing CRM data.
 */
export function portableToolSchema(schema: z.ZodType): Record<string, unknown> {
  const root = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  function visit(value: unknown, references = new Set<string>()): unknown {
    if (Array.isArray(value)) return value.map(child => visit(child, references));
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    if (typeof source.$ref === "string") {
      // Google rejects recursive $defs even for JSON configuration values.
      // Inline acyclic references and leave only recursive leaves open; the
      // original Zod schema still validates every supplied value on the server.
      if (references.has(source.$ref)) return { description: "JSON configuration value; validated by the CRM." };
      if (!source.$ref.startsWith("#/")) throw new Error("Tool schemas must use local references.");
      let target: unknown = root;
      for (const part of source.$ref.slice(2).split("/")) target = (target as Record<string, unknown>)?.[part.replaceAll("~1", "/").replaceAll("~0", "~")];
      if (!target) throw new Error("A tool schema reference could not be resolved.");
      const next = new Set(references); next.add(source.$ref);
      return visit(target, next);
    }
    const object = Object.fromEntries(Object.entries(source).filter(([key]) => key !== "$defs").map(([key, child]) => [key, visit(child, references)]));
    if ((Array.isArray(object.enum) && object.enum.includes("")) || object.const === "") {
      delete object.enum; delete object.const;
      object.type = "string";
      object.description = `${object.description ?? ""} An empty string is allowed; keep any other value within the CRM field's documented options.`.trim();
    }
    return object;
  }
  return visit(root) as Record<string, unknown>;
}
