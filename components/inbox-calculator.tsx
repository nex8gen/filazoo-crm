"use client";

import { useEffect, useId, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator, Delete, Divide, Equal, GripHorizontal, Minus, Percent, Plus, X } from "lucide-react";
import { calculatorInput, initialCalculator } from "@/lib/calculator";

const keys = ["AC", "±", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "⌫", "0", ".", "="];
const labels: Record<string, string> = { AC: "Clear all", "±": "Change sign", "%": "Percent", "÷": "Divide", "×": "Multiply", "−": "Subtract", "+": "Add", "⌫": "Backspace", ".": "Decimal point", "=": "Equals" };
const keyIcons: Record<string, typeof Delete> = { "⌫": Delete, "÷": Divide, "×": X, "−": Minus, "+": Plus, "%": Percent, "=": Equal };

export function InboxCalculator() {
  const [open, setOpen] = useState(false);
  const [state, input] = useReducer(calculatorInput, initialCalculator);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const id = useId();

  function move(x: number, y: number) {
    const bounds = panel.current?.getBoundingClientRect();
    setPosition({ x: Math.max(0, Math.min(x, window.innerWidth - (bounds?.width ?? 288))), y: Math.max(0, Math.min(y, window.innerHeight - (bounds?.height ?? 410))) });
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    function resize() {
      const bounds = panel.current?.getBoundingClientRect();
      if (bounds) setPosition((current) => ({ x: Math.max(0, Math.min(current.x, window.innerWidth - bounds.width)), y: Math.max(0, Math.min(current.y, window.innerHeight - bounds.height)) }));
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);

  return <>
    <button ref={trigger} type="button" title="Calculator" aria-label="Calculator" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => {
      if (!open) setPosition({ x: Math.max(0, window.innerWidth - 320), y: Math.max(0, Math.min(140, window.innerHeight - 440)) });
      setOpen(!open);
    }} className={`rounded-md p-2 hover:bg-muted ${open ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "text-muted-foreground"}`}><Calculator className="size-4" /></button>
    {open ? createPortal(
      <div ref={panel} id={id} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} tabIndex={-1} style={{ left: position.x, top: position.y }} className="fixed z-[100] w-72 max-w-[100vw] overflow-hidden rounded-2xl border border-border/80 bg-background text-foreground shadow-[0_16px_64px_-12px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.06)] outline-none" onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); close(); return; }
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if ((event.target as HTMLElement).dataset.moveHandle && event.key.startsWith("Arrow")) return;
        const key = ({ "*": "×", "/": "÷", "-": "−", Enter: "=", Backspace: "⌫", Delete: "AC" } as Record<string, string>)[event.key] ?? event.key;
        if (/^[0-9.]$/.test(key) || keys.includes(key)) { event.preventDefault(); event.stopPropagation(); input(key); }
      }}>
        <div className="flex items-center border-b border-border/60 px-4 py-3">
          <div tabIndex={0} role="button" data-move-handle="true" aria-label="Move calculator. Drag or use arrow keys." className="flex min-w-0 flex-1 touch-none select-none items-center gap-2 rounded py-1 outline-none cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
          }} onPointerMove={(event) => {
            if (drag.current) move(drag.current.left + event.clientX - drag.current.x, drag.current.top + event.clientY - drag.current.y);
          }} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={(event) => {
            const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
            if (delta) { event.preventDefault(); event.stopPropagation(); move(position.x + delta[0], position.y + delta[1]); }
          }}><span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><Calculator className="size-4" /></span><span id={`${id}-title`} className="text-sm font-semibold">Calculator</span><GripHorizontal className="ml-auto size-4 text-muted-foreground/60" /></div>
          <button type="button" title="Close calculator" aria-label="Close calculator" onClick={close} className="ml-2 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button>
        </div>
        <div className="max-h-[calc(100dvh-72px)] overflow-y-auto p-4 pt-2">
          <div className="mb-4 px-1 pb-2 pt-3 text-right">
            <div className="mb-1 h-5 text-xs font-medium tabular-nums text-muted-foreground">{state.operator ? `${state.stored} ${state.operator}` : "\u00a0"}</div>
            <output aria-live="polite" aria-label="Calculator result" className={`block overflow-x-auto font-medium tracking-tight tabular-nums ${state.display.length > 10 ? "text-2xl" : "text-4xl"}`}>{state.display}</output>
          </div>
          <div className="grid grid-cols-4 gap-2">{keys.map((key) => {
            const Icon = keyIcons[key];
            const operator = ["+", "−", "×", "÷"].includes(key);
            return <button key={key} type="button" title={labels[key] ?? key} aria-label={labels[key] ?? key} onClick={() => input(key)} className={`flex h-12 items-center justify-center rounded-xl border text-lg font-medium transition-[background-color,box-shadow,transform] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${key === "=" ? "border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700" : operator ? "border-emerald-500/10 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300" : key === "AC" || key === "⌫" ? "border-border/40 bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground" : "border-border/50 bg-muted/30 text-foreground shadow-xs hover:bg-muted/70"}`}>{Icon ? <Icon aria-hidden="true" className="size-[19px]" strokeWidth={1.75} /> : <span className={key === "AC" ? "text-xs font-semibold tracking-wide" : ""}>{key}</span>}</button>;
          })}</div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/80"><GripHorizontal aria-hidden="true" className="size-3" />Drag to move<span className="mx-1 text-border">·</span><span className="rounded border px-1 text-[9px]">esc</span> to close</p>
        </div>
      </div>, document.body,
    ) : null}
  </>;
}
