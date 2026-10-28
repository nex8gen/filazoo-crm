"use client";

import { useId, type ComponentPropsWithoutRef } from "react";
import { cn } from "cn";

const sparkle = "M 12 3 C 12.9 7.4 16.6 11.1 21 12 C 16.6 12.9 12.9 16.6 12 21 C 11.1 16.6 7.4 12.9 3 12 C 7.4 11.1 11.1 7.4 12 3 Z";
const blobA = "M 12 4.2 C 16.8 3.4 20.6 7.2 19.8 12 C 20.6 16.4 16.4 20.6 12 19.8 C 7.8 20.6 3.4 16.8 4.2 12 C 3.4 7.6 7.2 3.4 12 4.2 Z";
const circle = "M 12 5 C 15.87 5 19 8.13 19 12 C 19 15.87 15.87 19 12 19 C 8.13 19 5 15.87 5 12 C 5 8.13 8.13 5 12 5 Z";
const blobB = "M 12 3.6 C 16.4 4.6 18.6 8 19.2 12 C 18.6 16.2 16.2 19.4 12 20.4 C 8 19.4 5.2 16.4 4.8 12 C 5.4 7.8 7.6 4.4 12 3.6 Z";
const twinkle = "M 19 2.5 C 19.18 4.32 19.68 4.82 21.5 5 C 19.68 5.18 19.18 5.68 19 7.5 C 18.82 5.68 18.32 5.18 16.5 5 C 18.32 4.82 18.82 4.32 19 2.5 Z";
const timing = { keyTimes: "0;0.3;0.5;0.7;1", calcMode: "spline" as const, keySplines: "0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1" };

/** Native SVG keeps the original morph, rotation and twinkle without a global animation bundle. */
function AnimatedGlyph({ duration }: { duration: number }) {
  const gradientId = useId();
  const dur = `${duration}s`;
  return <svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 24 24">
    <defs><linearGradient id={gradientId} x1="5" x2="20" y1="4" y2="20" gradientUnits="userSpaceOnUse"><stop stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity="0.4" /></linearGradient></defs>
    <g className="motion-safe:hidden"><path d={sparkle} fill={`url(#${gradientId})`} /><path d={twinkle} fill="currentColor" opacity="0.5" /></g>
    <g className="motion-reduce:hidden">
      <g><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur={dur} repeatCount="indefinite" />
        <g transform="translate(12 12)"><g><animateTransform {...timing} attributeName="transform" type="scale" values="1;0.9;0.78;0.9;1" dur={dur} repeatCount="indefinite" />
          <g transform="translate(-12 -12)"><path d={sparkle} fill={`url(#${gradientId})`}><animate {...timing} attributeName="d" values={[sparkle, blobA, circle, blobB, sparkle].join(";")} dur={dur} repeatCount="indefinite" /></path></g>
        </g></g>
      </g>
      <g transform="translate(19 5)"><g><animateTransform {...timing} attributeName="transform" type="rotate" values="0;45;90;135;180" dur={dur} repeatCount="indefinite" />
        <g><animateTransform {...timing} attributeName="transform" type="scale" values="0.2;0.5;1;0.5;0.2" dur={dur} repeatCount="indefinite" />
          <g transform="translate(-19 -5)"><path d={twinkle} fill="currentColor" opacity="0"><animate {...timing} attributeName="opacity" values="0;0;1;0;0" dur={dur} repeatCount="indefinite" /></path></g>
        </g>
      </g></g>
    </g>
  </svg>;
}

type AiIconProps = ComponentPropsWithoutRef<"span"> & {
  state?: "idle" | "thinking" | "error";
};

/** Shared AI identity. The surrounding control supplies its accessible label. */
export function AiIcon({ className, state = "idle", ...props }: AiIconProps) {
  return (
    <span {...props} aria-hidden="true" data-state={state} className={cn("inline-grid size-4 shrink-0 place-items-center align-middle text-primary", state === "error" && "text-destructive", className)}>
      <AnimatedGlyph key={state} duration={state === "thinking" ? 2.4 : 4} />
    </span>
  );
}
