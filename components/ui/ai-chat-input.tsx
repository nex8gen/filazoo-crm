"use client";

import { useId, useState, useSyncExternalStore, type RefObject } from "react";
import { useTheme } from "next-themes";
import { ArrowUp, AtSign, ChevronDown, Sparkles } from "lucide-react";
import { BorderBeam } from "@/components/ui/border-beam";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./ai-chat-input.css";
import { WebSearchOption } from "@/components/ui/customer-research";

type AiChatInputProps = {
  contextLabel: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  busy?: boolean;
  shortcuts: { label: string; prompt: string }[];
  webSearch?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
};

const subscribeToMount = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

const composerBeamCss = `
  @media (prefers-reduced-motion: reduce) {
    [data-beam="{id}"] {
      --beam-opacity-{id}: 1;
      --beam-angle-{id}: 135deg;
    }
  }
`;

export function AiChatInput({ contextLabel, value, onChange, onSend, inputRef, disabled = false, busy = false, shortcuts, webSearch = false, onWebSearchChange }: AiChatInputProps) {
  const id = useId();
  const [showContext, setShowContext] = useState(false);
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribeToMount, clientMounted, serverMounted);
  const beamTheme = mounted && resolvedTheme === "light" ? "light" : "dark";

  return <form onSubmit={(event) => { event.preventDefault(); if (!disabled && value.trim()) onSend(); }} className="min-w-0">
    <BorderBeam size="md" colorVariant="colorful" theme={beamTheme} active={mounted} borderRadius={20} strength={1} saturation={beamTheme === "light" ? 1.5 : 1.25} brightness={beamTheme === "light" ? 1 : 1.3} duration={3} css={composerBeamCss} className="customer-chat-beam" style={{ display: "block", width: "100%" }}>
      <div className="customer-chatbox">
        <div className="customer-chatbox-inner">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <button type="button" aria-expanded={showContext} aria-controls={`${id}-context`} title="Show this chat's customer context" onClick={() => setShowContext((open) => !open)} className="customer-chat-chip max-w-[85%] gap-1.5 px-2">
              <AtSign aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span data-no-translate className="truncate text-[11px]">{contextLabel}</span>
            </button>
            {busy ? <span role="status" className="pr-1 text-[11px] text-muted-foreground">Working…</span> : null}
          </div>
          {showContext ? <p id={`${id}-context`} className="mx-1 mt-2 rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">This conversation uses the saved profile, contacts and permitted activity for <span data-no-translate className="font-medium text-foreground">{contextLabel}</span>.</p> : null}
          <label htmlFor={id} className="sr-only">Ask AI about this customer</label>
          <textarea ref={inputRef} id={id} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled && value.trim()) onSend();
            }
          }} maxLength={6_000} disabled={disabled} placeholder="Ask anything about this customer…" rows={2} className="customer-chat-textarea" />
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger disabled={disabled} className="customer-chat-chip gap-1 pl-2.5 pr-1.5" aria-label="Customer assistant shortcuts">
                <Sparkles aria-hidden="true" className="mr-0.5 size-3 text-muted-foreground" /><span>Assistant</span><ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-48">
                {shortcuts.map(({ label, prompt }) => <DropdownMenuItem key={label} onClick={() => onChange(prompt)}>{label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="customer-chat-chip gap-1 px-2.5" title="Uses the CRM's configured AI provider automatically">Auto</span>
            {onWebSearchChange ? <WebSearchOption enabled={webSearch} onChange={onWebSearchChange} disabled={disabled} /> : null}
            <button type="submit" disabled={disabled || !value.trim()} aria-label="Send customer question" title="Send question" className="customer-chat-chip customer-chat-send ml-auto size-8 !p-0"><ArrowUp aria-hidden="true" className="size-4" /></button>
          </div>
        </div>
      </div>
    </BorderBeam>
    <p className="mt-2.5 text-center text-[11px] leading-5 text-muted-foreground">Enter to send · Shift + Enter for a new line</p>
  </form>;
}
