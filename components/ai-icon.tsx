import type { ComponentPropsWithoutRef } from "react";
import { cn } from "cn";
import { ThinkingGlyph } from "@/components/ui/thinking-indicator";

type AiIconProps = ComponentPropsWithoutRef<"span"> & {
  state?: "idle" | "thinking" | "error";
};

/** Shared AI identity. The surrounding control supplies its accessible label. */
export function AiIcon({ className, state = "idle", ...props }: AiIconProps) {
  return (
    <span {...props} aria-hidden="true" data-state={state} className={cn("inline-grid size-4 shrink-0 place-items-center align-middle text-violet-600 dark:text-violet-300", state === "error" && "text-destructive", className)}>
      <ThinkingGlyph className="size-full" duration={state === "thinking" ? 2.4 : 4} />
    </span>
  );
}
