import type { ComponentPropsWithoutRef } from "react";
import { cn } from "cn";
import "./ai-icon.css";

type AiIconProps = ComponentPropsWithoutRef<"span"> & {
  state?: "idle" | "thinking" | "error";
};

/** Shared AI identity. The surrounding control supplies its accessible label. */
export function AiIcon({ className, state = "idle", ...props }: AiIconProps) {
  return (
    <span {...props} aria-hidden="true" data-state={state} className={cn("ai-icon relative inline-grid size-4 shrink-0 place-items-center align-middle", className)}>
      <span className="ai-icon-mist">
        <span className="ai-icon-pink" />
        <span className="ai-icon-blue" />
        <span className="ai-icon-cyan" />
      </span>
    </span>
  );
}
