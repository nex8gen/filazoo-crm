"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AiIcon } from "@/components/ai-icon";
import { AgentIcon } from "@/components/agent-icon";
import "./ai-launcher.css";

export function AiLauncher({ onSelect }: { onSelect: (mode: "chat" | "agent") => void }) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const revealOnClick = useRef(false);
  const agentId = useId();

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  return (
    <div
      ref={root}
      role="group"
      aria-label="Filazoo AI"
      data-expanded={expanded}
      className="workspace-ai-launcher fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-[55] sm:right-7"
      onPointerEnter={event => { if (event.pointerType !== "touch") setExpanded(true); }}
      onPointerDown={event => { revealOnClick.current = event.pointerType === "touch" && !expanded; }}
      onPointerLeave={event => { if (event.pointerType !== "touch" && !event.currentTarget.contains(document.activeElement)) setExpanded(false); }}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          root.current?.querySelector("button")?.focus();
          setExpanded(false);
        }
      }}
    >
      {/* Keep the halo separate from scrolling content and the pill's paint layer. */}
      <span aria-hidden="true" className="workspace-ai-launcher-halo" />
      <span aria-hidden="true" className="workspace-ai-launcher-shell" />
      <div className="workspace-ai-launcher-options">
        <button
          type="button"
          aria-label="Open Filazoo Chat"
          aria-expanded={expanded}
          aria-controls={agentId}
          className="workspace-ai-launcher-option"
          onClick={event => {
            if (revealOnClick.current && event.detail > 0) {
              revealOnClick.current = false;
              setExpanded(true);
            } else onSelect("chat");
          }}
        >
          <span aria-hidden="true" className="workspace-ai-launcher-idle">
            <span className="workspace-ai-launcher-idle-track">
              <span className="workspace-ai-launcher-idle-chat"><AiIcon className="size-12" /></span>
              <span className="workspace-ai-launcher-idle-agent"><AgentIcon className="size-10" /></span>
              <span className="workspace-ai-launcher-idle-chat-return"><AiIcon className="size-12" /></span>
            </span>
          </span>
          <AiIcon className="workspace-ai-launcher-chat-icon" />
        </button>
        <button
          id={agentId}
          type="button"
          aria-label="Open Filazoo Agent"
          aria-hidden={!expanded}
          disabled={!expanded}
          className="workspace-ai-launcher-option workspace-ai-launcher-agent"
          onClick={() => onSelect("agent")}
        >
          <AgentIcon className="workspace-ai-launcher-agent-icon" />
        </button>
      </div>
    </div>
  );
}
