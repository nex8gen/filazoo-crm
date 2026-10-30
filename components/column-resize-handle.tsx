"use client";

import { useEffect, useRef } from "react";

type Props = {
  label: string;
  variable: string;
  container: string;
  panel: string;
  min: number;
  max: number;
  reverse?: boolean;
  className?: string;
  storageKey?: string;
  orientation?: "vertical" | "horizontal";
};

/** A divider that changes a CSS size without rerendering the panel contents. */
export function ColumnResizeHandle({ label, variable, container, panel, min, max, reverse = false, className = "", storageKey = variable, orientation = "vertical" }: Props) {
  const horizontal = orientation === "horizontal";
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; limit: number } | null>(null);
  const key = `filazoo:column:${storageKey}`;

  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>(container);
    try {
      const saved = Number(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved >= min && saved <= max) root?.style.setProperty(variable, `${saved}px`);
    } catch { /* Resizing also works when storage is unavailable. */ }
  }, [container, key, max, min, variable]);

  function elements() {
    const root = ref.current?.closest<HTMLElement>(container);
    return { root, target: root?.querySelector<HTMLElement>(panel) };
  }

  function limit() {
    const { root, target } = elements();
    if (!root || !target) return max;
    if (horizontal) {
      const conversation = root.querySelector<HTMLElement>(".mail-conversation");
      const height = root.getBoundingClientRect().height;
      return Math.max(min, Math.min(max, height * 0.75, height - 120, target.getBoundingClientRect().height + (conversation?.getBoundingClientRect().height ?? 0) - 100));
    }
    if (variable === "--workspace-ai-preferred-width") return Math.max(min, Math.min(max, window.innerWidth - 600));
    const visibleReader = root.querySelector<HTMLElement>(".mail-reader");
    const reader = visibleReader && visibleReader.getBoundingClientRect().width > 0 ? visibleReader : root.querySelector<HTMLElement>(".mail-list");
    return Math.max(min, Math.min(max, target.getBoundingClientRect().width + (reader?.getBoundingClientRect().width ?? 0) - 280));
  }

  function resize(width: number, upper = limit()) {
    const { root } = elements();
    const next = Math.round(Math.max(min, Math.min(upper, width)));
    root?.style.setProperty(variable, `${next}px`);
    ref.current?.setAttribute("aria-valuenow", String(next));
    return next;
  }

  function save() {
    const { root } = elements();
    try { localStorage.setItem(key, String(parseFloat(root?.style.getPropertyValue(variable) || ""))); } catch { /* Optional preference. */ }
  }

  return <div ref={ref} role="separator" aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
    onFocus={() => { const rect = elements().target?.getBoundingClientRect(); ref.current?.setAttribute("aria-valuenow", String(Math.round((horizontal ? rect?.height : rect?.width) ?? min))); }}
    title={`${label}: drag to resize, double-click to reset`}
    className={`column-resize-handle ${className}`}
    onPointerDown={(event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const { target } = elements();
      if (!target) return;
      event.preventDefault();
      drag.current = { x: horizontal ? event.clientY : event.clientX, width: horizontal ? target.getBoundingClientRect().height : target.getBoundingClientRect().width, limit: limit() };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = "true";
    }}
    onPointerMove={(event) => {
      if (drag.current) resize(drag.current.width + ((horizontal ? event.clientY : event.clientX) - drag.current.x) * (reverse ? -1 : 1), drag.current.limit);
    }}
    onPointerUp={(event) => {
      if (!drag.current) return;
      save();
      drag.current = null;
      delete event.currentTarget.dataset.dragging;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onLostPointerCapture={(event) => { drag.current = null; delete event.currentTarget.dataset.dragging; }}
    onPointerCancel={(event) => { drag.current = null; delete event.currentTarget.dataset.dragging; }}
    onDoubleClick={() => {
      elements().root?.style.removeProperty(variable);
      ref.current?.removeAttribute("aria-valuenow");
      try { localStorage.removeItem(key); } catch { /* Optional preference. */ }
    }}
    onKeyDown={(event) => {
      const decrease = horizontal ? "ArrowUp" : "ArrowLeft";
      const increase = horizontal ? "ArrowDown" : "ArrowRight";
      if (![decrease, increase, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const rect = elements().target?.getBoundingClientRect();
      const width = (horizontal ? rect?.height : rect?.width) ?? min;
      resize(event.key === "Home" ? min : event.key === "End" ? limit() : width + (event.key === increase ? 1 : -1) * (reverse ? -1 : 1) * (event.shiftKey ? 40 : 10));
      save();
    }} />;
}
