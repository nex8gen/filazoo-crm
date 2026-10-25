"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export type AvatarColor = "blue" | "orange" | "red" | "green" | "purple" | "yellow" | "cyan" | "pink" | "indigo" | "lime" | "turquoise" | "violet";
export type AvatarSize = "sm" | "md" | "lg";
export type AvatarShape = "circle" | "square" | "squircle";

export interface AvatarProps {
  blinking?: boolean;
  working?: boolean;
  glow?: boolean;
  color?: AvatarColor;
  size?: AvatarSize;
  shape?: AvatarShape;
  className?: string;
}

const palette: Record<AvatarColor, [string, string, string, string]> = {
  blue: ["#0d4d9a", "#3d7dd8", "#6fb3ff", "#e0eeff"], orange: ["#a63e10", "#e27a2a", "#ffb46a", "#ffe8cc"],
  red: ["#a60033", "#e74668", "#ff8aaa", "#ffd6e8"], green: ["#0d6632", "#2a9d5f", "#6dd187", "#d1fadd"],
  purple: ["#4a0080", "#8b3fd1", "#c896ff", "#e8d4ff"], yellow: ["#8a5500", "#d4a000", "#ffc93a", "#fff5cc"],
  cyan: ["#003d66", "#0a8fb5", "#5dd4ff", "#cdf5ff"], pink: ["#7a0055", "#d63384", "#ff6bb3", "#ffe5f5"],
  indigo: ["#2d157a", "#4f46e5", "#8b7eff", "#ddd6ff"], lime: ["#4a5910", "#84cc16", "#bef264", "#ecfccf"],
  turquoise: ["#1a5555", "#0d9488", "#2dd4bf", "#ccfbf1"], violet: ["#4a2a7a", "#a855f7", "#d8b4fe", "#f3e8ff"],
};

const sizes = { sm: { orb: "size-8", eye: "h-1.5 w-1", gap: "gap-1.5", y: "-translate-y-0.5" }, md: { orb: "size-12", eye: "h-2.5 w-1.5", gap: "gap-2.5", y: "-translate-y-0.5" }, lg: { orb: "size-16", eye: "h-3 w-2", gap: "gap-3.5", y: "-translate-y-1" } };
const radii = { circle: "rounded-full", square: "rounded-none", squircle: "rounded-[40%]" };

export default function AgentAvatar({ blinking = true, working = false, glow = true, color = "violet", size = "md", shape = "squircle", className }: AvatarProps) {
  const uid = useId().replace(/\W/g, "");
  const [dark, mid, light, pale] = palette[color];
  const dimensions = sizes[size];
  return <>
    <style>{`@keyframes av-blink-${uid}{0%,88%,100%{transform:scaleY(1)}93%,97%{transform:scaleY(.07)}}`}</style>
    <motion.span aria-label={working ? "Agent working" : "Agent mode"} role="img" animate={working ? { scale: [1, 1.08, 0.96, 1], rotate: [0, -3, 3, 0] } : { scale: 1, rotate: 0 }} whileTap={{ scaleX: 1.15, scaleY: 1.3 }} transition={working ? { duration: 1.8, ease: "easeInOut", repeat: Infinity } : { type: "tween", duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }} className={cn("relative flex shrink-0 items-center justify-center overflow-hidden", dimensions.orb, radii[shape], className)} style={{ background: `radial-gradient(circle at 50% 45%,${dark} 0%,${mid} 40%,${light} 68%,${pale} 100%)`, boxShadow: glow ? `0 0 3px ${mid}4d,0 0 12px 4px ${mid}24,inset 0 0 0 1px rgba(255,255,255,.08)` : "none" }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full opacity-20 mix-blend-overlay"><defs><filter id={`noise-${uid}`}><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="4" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter></defs><rect width="100%" height="100%" filter={`url(#noise-${uid})`} /></svg>
      <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 30% 24%,rgba(255,255,255,.75),rgba(255,255,255,.1) 50%,transparent 70%)" }} />
      <span className={cn("relative z-10 flex items-center", dimensions.gap, dimensions.y)}>{[0, 60].map((delay) => <span key={delay} className={cn("rounded-full", dimensions.eye)} style={{ background: `linear-gradient(135deg,#fff 0%,${pale} 100%)`, animation: blinking ? `av-blink-${uid} 3.6s ease-in-out ${delay}ms infinite` : undefined }} />)}</span>
    </motion.span>
  </>;
}
