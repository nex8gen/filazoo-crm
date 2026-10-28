"use client";

import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { cn } from "cn";
import "./agent-icon.css";

type AgentIconProps = ComponentPropsWithoutRef<"span"> & {
  state?: "idle" | "thinking" | "error";
  textLength?: number;
  isListening?: boolean;
};

/** Shared robot mascot, scaled for navigation and the message composer. */
export function AgentIcon({ className, state = "idle", textLength = 0, isListening = false, style, ...props }: AgentIconProps) {
  return <span {...props} aria-hidden="true" data-state={state} data-listening={isListening} className={cn("ai-robot inline-grid size-4 shrink-0 place-items-center align-middle", className)} style={{ ...style, "--robot-eye-offset": `${Math.sin(textLength * 0.45) * 5}px` } as CSSProperties}>
    <svg className="size-full overflow-visible" fill="none" viewBox="0 0 104 84">
      <g className="ai-robot-head">
        <path d="M20 22v-9a6 6 0 0 1 6-6h7v15M71 22V7h7a6 6 0 0 1 6 6v9" className="ai-robot-shell" strokeWidth="2" />
        <rect x="3" y="37" width="6" height="23" rx="2" className="ai-robot-light" />
        <rect x="95" y="37" width="6" height="23" rx="2" className="ai-robot-light" />
        <rect x="10" y="21" width="84" height="57" rx="12" className="ai-robot-shell" strokeWidth="2" />
        <rect x="17" y="28" width="70" height="43" rx="7" fill="#050505" />
        <g className="ai-robot-eyes">
          <rect x="33" y="40" width="10" height="19" rx="2" className="ai-robot-light ai-robot-eye" />
          <rect x="61" y="40" width="10" height="19" rx="2" className="ai-robot-light ai-robot-eye" />
        </g>
        <path d="M20 34h64M20 38h64M20 42h64M20 46h64M20 50h64M20 54h64M20 58h64M20 62h64M20 66h64" stroke="#050505" strokeOpacity=".35" strokeWidth="1.5" />
      </g>
    </svg>
  </span>;
}
