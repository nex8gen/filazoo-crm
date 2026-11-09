"use client";

import { useRef, useState, type ReactNode, type RefObject, type ClipboardEventHandler } from "react";
import { ArrowUp, ArrowUpRight, ClipboardList, Mail, Plus, Square, Target } from "lucide-react";
import { AiIcon } from "@/components/ai-icon";
import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { launchWorkspaceAi } from "@/lib/ai/launch";

const starters = [
  { icon: Target, label: "Find sales opportunities", prompt: "Review my assigned customers and identify the strongest sales opportunities. Explain the evidence and suggest the next action for each." },
  { icon: Mail, label: "Draft a follow-up", prompt: "Help me draft a customer follow-up. First ask which customer and what I want to achieve, then prepare a draft for review." },
  { icon: ClipboardList, label: "Review my orders", prompt: "Review the purchase orders for my assigned customers. Highlight outstanding items and suggest the next steps." },
];

export function HomeAiComposer({ name, asOf }: { name: string; asOf: string }) {
  const [mode, setMode] = useState<"chat" | "agent">("chat");
  const [question, setQuestion] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(new Date(asOf)));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const openAi = (prompt = "") => {
    launchWorkspaceAi({ mode, ...(prompt.trim() ? { prompt: prompt.trim(), submit: true } : {}) });
    if (prompt.trim()) setQuestion("");
  };

  return <section aria-labelledby="home-ai-heading" className="home-ai">
    <header className="home-ai-welcome">
      <h2 id="home-ai-heading">{greeting}, <span data-no-translate>{name}</span>!</h2>
      <p>Let’s keep your business moving.</p>
    </header>
    <HomeAiInput id="home-ai-question" inputRef={input} mode={mode} onModeChange={setMode} value={question} onChange={setQuestion} onSend={openAi} onOpen={() => launchWorkspaceAi({ mode, ...(question.trim() ? { prompt: question.trim() } : {}) })} canSend={Boolean(question.trim())} />
  </section>;
}

type HomeAiInputProps = {
  id: string; inputRef: RefObject<HTMLTextAreaElement | null>;
  mode: "chat" | "agent"; onModeChange: (mode: "chat" | "agent") => void;
  value: string; onChange: (value: string) => void; onSend: (value: string) => void;
  canSend: boolean; busy?: boolean; canStop?: boolean; onStop?: () => void; onOpen?: () => void;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>; children?: ReactNode; tools?: ReactNode;
};

export function HomeAiInput({ id, inputRef, mode, onModeChange, value, onChange, onSend, canSend, busy = false, canStop = false, onStop, onOpen, onPaste, children, tools }: HomeAiInputProps) {
  const [promptsOpen, setPromptsOpen] = useState(false);
  return <form onSubmit={event => { event.preventDefault(); if (canSend) onSend(value); }} className="home-composer ai-composer">
      <label htmlFor={id} className="sr-only">Ask Filazoo AI</label>
      {children}
      <textarea ref={inputRef} id={id} aria-describedby={`${id}-hint`} value={value} disabled={busy} onPaste={onPaste} onChange={event => onChange(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) onSend(value); }
      }} maxLength={6000} rows={1} placeholder={mode === "chat" ? "Ask Filazoo anything…" : "What would you like to get done?"} className="home-composer-input" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="AI assistant mode" className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {(["chat", "agent"] as const).map(option => <button key={option} type="button" disabled={busy} aria-pressed={mode === option} onClick={() => { onModeChange(option); inputRef.current?.focus(); }} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium disabled:opacity-50 ${mode === option ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {option === "chat" ? <AiIcon className="size-3.5" /> : <AgentIcon className="size-3.5" />}{option === "chat" ? "Chat" : "Agent"}
          </button>)}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {tools ? <div className="home-composer-tools flex items-center gap-1">{tools}</div> : null}
          <Popover open={promptsOpen} onOpenChange={setPromptsOpen}>
            <PopoverTrigger disabled={busy} aria-label="Quick prompts" title="Quick prompts" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"><Plus className="size-4" /></PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={12} className="!w-64 !gap-1 !rounded-xl !p-2">
              <PopoverTitle className="px-2 py-1.5 text-xs">Quick prompts</PopoverTitle>
              {starters.map(({ icon: Icon, label, prompt }) => <button key={label} type="button" disabled={busy} onClick={() => { setPromptsOpen(false); onChange(prompt); inputRef.current?.focus(); }} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Icon className="size-3.5 shrink-0" aria-hidden="true" />{label}</button>)}
            </PopoverContent>
          </Popover>
          {onOpen ? <button type="button" onClick={onOpen} aria-label="Open conversation" title="Open conversation" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowUpRight className="size-4" /></button> : null}
          <Button type={busy ? "button" : "submit"} onClick={busy && canStop ? onStop : undefined} size="icon" disabled={busy ? !canStop : !canSend} aria-label={busy ? canStop ? "Stop AI response" : "Agent action in progress" : "Send to Filazoo AI"} title={busy ? "Stop AI response" : "Send to Filazoo AI"} className="size-8 rounded-full">{busy ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" />}</Button>
        </div>
      </div>
      <p id={`${id}-hint`} className="sr-only">Enter to send · Shift + Enter for a new line</p>
    </form>;
}
