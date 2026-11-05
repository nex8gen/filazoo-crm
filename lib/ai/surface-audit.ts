import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Inventory UI server actions and mutating HTTP exports; no database or model calls. */
export function crmMutationSurfaces(root: string) {
  const result: string[] = [];
  function walk(folder: string) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith("actions.ts") && entry.name !== "route.ts") continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)) {
        if (entry.name === "route.ts" && !["POST", "PUT", "PATCH", "DELETE"].includes(match[1])) continue;
        result.push(`${relative(root, path).replaceAll("\\", "/")}#${match[1]}`);
      }
    }
  }
  walk(join(root, "app"));
  return result.sort();
}
