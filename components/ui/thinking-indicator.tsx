"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type CSSProperties, forwardRef, type HTMLAttributes, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

const sparkle = "M 12 3 C 12.9 7.4 16.6 11.1 21 12 C 16.6 12.9 12.9 16.6 12 21 C 11.1 16.6 7.4 12.9 3 12 C 7.4 11.1 11.1 7.4 12 3 Z";
const blobA = "M 12 4.2 C 16.8 3.4 20.6 7.2 19.8 12 C 20.6 16.4 16.4 20.6 12 19.8 C 7.8 20.6 3.4 16.8 4.2 12 C 3.4 7.6 7.2 3.4 12 4.2 Z";
const circle = "M 12 5 C 15.87 5 19 8.13 19 12 C 19 15.87 15.87 19 12 19 C 8.13 19 5 15.87 5 12 C 5 8.13 8.13 5 12 5 Z";
const blobB = "M 12 3.6 C 16.4 4.6 18.6 8 19.2 12 C 18.6 16.2 16.2 19.4 12 20.4 C 8 19.4 5.2 16.4 4.8 12 C 5.4 7.8 7.6 4.4 12 3.6 Z";
const twinkle = "M 19 2.5 C 19.18 4.32 19.68 4.82 21.5 5 C 19.68 5.18 19.18 5.68 19 7.5 C 18.82 5.68 18.32 5.18 16.5 5 C 18.32 4.82 18.82 4.32 19 2.5 Z";
const times = [0, 0.3, 0.5, 0.7, 1];

export function ThinkingGlyph({ className, duration = 4 }: { className?: string; duration?: number }) {
  const gradientId = useId();
  const reduceMotion = useReducedMotion() ?? false;
  return <svg aria-hidden="true" className={cn("size-[1em] shrink-0", className)} fill="none" viewBox="0 0 24 24">
    <defs><linearGradient gradientUnits="userSpaceOnUse" id={gradientId} x1="5" x2="20" y1="4" y2="20"><stop offset="0" stopColor="currentColor" stopOpacity="1" /><stop offset="1" stopColor="currentColor" stopOpacity="0.4" /></linearGradient></defs>
    {reduceMotion ? <><path d={sparkle} fill={`url(#${gradientId})`} /><path d={twinkle} fill="currentColor" opacity={0.5} /></> : <>
      <motion.path animate={{ d: [sparkle, blobA, circle, blobB, sparkle], rotate: 360, scale: [1, 0.9, 0.78, 0.9, 1] }} d={sparkle} fill={`url(#${gradientId})`} style={{ transformBox: "view-box", transformOrigin: "center" }} transition={{ d: { duration, ease: "easeInOut", repeat: Infinity, times }, scale: { duration, ease: "easeInOut", repeat: Infinity, times }, rotate: { duration, ease: "linear", repeat: Infinity } }} />
      <motion.path animate={{ opacity: [0, 0, 1, 0, 0], rotate: [0, 45, 90, 135, 180], scale: [0.2, 0.5, 1, 0.5, 0.2] }} d={twinkle} fill="currentColor" style={{ transformBox: "fill-box", transformOrigin: "center" }} transition={{ duration, ease: "easeInOut", repeat: Infinity, times }} />
    </>}
  </svg>;
}

export interface ThinkingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  words: string[];
  interval?: number;
  showIcon?: boolean;
}

const ThinkingIndicator = forwardRef<HTMLDivElement, ThinkingIndicatorProps>(({ className, words, interval = 3200, showIcon = true, ...props }, ref) => {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion() ?? false;
  const word = words.length > 0 ? words[index % words.length] : "";
  const longestWord = words.reduce((a, b) => a.length >= b.length ? a : b, "");

  useEffect(() => {
    if (reduceMotion || words.length <= 1) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % words.length), interval);
    return () => window.clearInterval(timer);
  }, [interval, reduceMotion, words.length]);

  return <div className={cn("flex items-center gap-[0.6em] text-muted-foreground", className)} ref={ref} role="status" {...props}>
    {words.length > 0 ? <span className="sr-only">{words[0]}…</span> : null}
    {showIcon ? <ThinkingGlyph className="h-[1lh] w-[1lh]" /> : null}
    {words.length > 0 ? <span aria-hidden="true" className="inline-grid overflow-hidden"><span className="invisible col-start-1 row-start-1">{longestWord}</span>{reduceMotion ? <span className="col-start-1 row-start-1">{words[0]}</span> : <AnimatePresence initial={false} mode="popLayout"><motion.span animate={{ y: 0, opacity: 1, filter: "blur(0px)", backgroundPosition: "0% center" }} className={cn("col-start-1 row-start-1 bg-[length:250%_100%,auto] bg-clip-text text-transparent [--ti-base:var(--muted-foreground)] [--ti-sheen:var(--foreground)] [background-repeat:no-repeat,padding-box]")} exit={{ y: "-70%", opacity: 0, filter: "blur(3px)", transition: { duration: 0.2 } }} initial={{ y: "70%", opacity: 0, filter: "blur(3px)", backgroundPosition: "100% center" }} key={word} style={{ "--ti-spread": `${word.length * 2}px`, backgroundImage: "linear-gradient(90deg,#0000 calc(50% - var(--ti-spread)),var(--ti-sheen),#0000 calc(50% + var(--ti-spread))), linear-gradient(var(--ti-base),var(--ti-base))" } as CSSProperties} transition={{ y: { type: "spring", stiffness: 420, damping: 34 }, opacity: { duration: 0.28 }, filter: { duration: 0.28 }, backgroundPosition: { duration: 2, ease: "linear", repeat: Infinity } }}>{word}</motion.span></AnimatePresence>}</span> : null}
  </div>;
});

ThinkingIndicator.displayName = "ThinkingIndicator";
export { ThinkingIndicator };
export default ThinkingIndicator;
