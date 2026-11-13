"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AiIcon } from "@/components/ai-icon";
import { AgentIcon } from "@/components/agent-icon";
import { HomePromptIcon } from "@/components/home-prompt-icon";
import { useLanguage } from "@/components/language-provider";
import { getPageAiPrompts } from "@/lib/page-ai-prompts";
import "./ai-launcher.css";

export function AiLauncher({ pathname, onSelect }: { pathname: string; onSelect: (mode: "chat" | "agent", prompt?: string) => void }) {
  const { t } = useLanguage();
  const suggestions = getPageAiPrompts(pathname);
  const [expanded, setExpanded] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState<"chat" | "agent">("chat");
  const root = useRef<HTMLDivElement>(null);
  const chatTrigger = useRef<HTMLButtonElement>(null);
  const revealOnClick = useRef(false);
  const agentId = useId();
  const promptsId = useId();

  const chooseMode = (mode: "chat" | "agent", clickDetail: number) => {
    if (revealOnClick.current && clickDetail > 0) {
      revealOnClick.current = false;
      setSuggestionMode(mode);
      setExpanded(true);
    } else onSelect(mode);
  };

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
      onPointerLeave={event => { if (event.pointerType !== "touch" && !event.currentTarget.contains(document.activeElement)) setExpanded(false); }}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }}
      onKeyDown={event => {
        if (event.key === "ArrowUp" && event.target instanceof HTMLElement && event.target.classList.contains("workspace-ai-launcher-option")) {
          event.preventDefault();
          root.current?.querySelector<HTMLButtonElement>(".workspace-ai-launcher-prompt")?.focus();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          chatTrigger.current?.focus();
          setExpanded(false);
        }
      }}
    >
      <div className="workspace-ai-launcher-control">
      {/* Keep the halo separate from scrolling content and the pill's paint layer. */}
      <span aria-hidden="true" className="workspace-ai-launcher-halo" />
      <span aria-hidden="true" className="workspace-ai-launcher-shell" />
      <div className="workspace-ai-launcher-options">
        <button
          ref={chatTrigger}
          type="button"
          aria-label="Open Filazoo Chat"
          aria-expanded={expanded && suggestionMode === "chat"}
          aria-controls={expanded && suggestionMode === "chat" ? promptsId : undefined}
          className="workspace-ai-launcher-option"
          onPointerDown={event => { revealOnClick.current = event.pointerType === "touch" && (!expanded || suggestionMode !== "chat"); }}
          onPointerEnter={event => { if (event.pointerType !== "touch") setSuggestionMode("chat"); }}
          onFocus={() => setSuggestionMode("chat")}
          onClick={event => chooseMode("chat", event.detail)}
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
          aria-expanded={expanded && suggestionMode === "agent"}
          aria-controls={expanded && suggestionMode === "agent" ? promptsId : undefined}
          className="workspace-ai-launcher-option workspace-ai-launcher-agent"
          onPointerDown={event => { revealOnClick.current = event.pointerType === "touch" && (!expanded || suggestionMode !== "agent"); }}
          onPointerEnter={event => { if (event.pointerType !== "touch") setSuggestionMode("agent"); }}
          onFocus={() => setSuggestionMode("agent")}
          onClick={event => chooseMode("agent", event.detail)}
        >
          <AgentIcon className="workspace-ai-launcher-agent-icon" />
        </button>
      </div>
      </div>
      {expanded ? <div id={promptsId} role="group" aria-label={t("Page-specific AI prompts")} className="workspace-ai-launcher-prompts">
        {suggestions.prompts.filter(item => item.mode === suggestionMode).map(item => <button key={item.id} type="button" className="workspace-ai-launcher-prompt" onClick={() => onSelect(item.mode, item.prompt)}>
          <span aria-hidden="true" className="workspace-ai-launcher-prompt-icon"><HomePromptIcon name={item.icon} size={22} /></span>
          <span className="workspace-ai-launcher-prompt-label">{t(item.label)}</span>
        </button>)}
      </div> : null}
    </div>
  );
}
