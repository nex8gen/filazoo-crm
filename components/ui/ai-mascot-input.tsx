"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { AgentIcon } from "@/components/agent-icon";
import { AiImageFeedback, AiImagePicker, AiImagePreviews, type AiImageAttachments } from "@/components/ui/ai-image-attachments";
import { WebSearchOption } from "@/components/ui/customer-research";
import "./ai-composer.css";
import { startVoiceInput, type VoiceRecognition } from "@/lib/ai/voice-input";

type AiMascotInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  attachments: AiImageAttachments;
  webSearch: boolean;
  onWebSearchChange: (value: boolean) => void;
  busy: boolean;
  loadingHistory?: boolean;
  canStop: boolean;
  active: boolean;
  language: string;
  label: string;
  placeholder: string;
  children?: ReactNode;
};

export function AiMascotInput({ id, value, onChange, onSend, onCancel, inputRef, attachments, webSearch, onWebSearchChange, busy, loadingHistory = false, canStop, active, language, label, placeholder, children }: AiMascotInputProps) {
  const reduceMotion = useReducedMotion();
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognition = useRef<ReturnType<typeof startVoiceInput> | null>(null);
  const canSend = !busy && !loadingHistory && !attachments.processing && Boolean(value.trim() || attachments.images.length);
  const engaged = Boolean(value.length || attachments.images.length || busy || listening);
  const mascotTransition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 230, damping: 26, mass: 1 };
  const mascot = <AgentIcon className="h-[72px] w-24" state={busy ? "thinking" : "idle"} textLength={value.length} isListening={listening && active && !busy} />;

  useEffect(() => {
    return () => {
      const current = recognition.current;
      recognition.current = null;
      current?.stop();
      setListening(false);
    };
  }, [active, busy, language]);

  function stopListening() {
    const current = recognition.current;
    recognition.current = null;
    current?.stop();
    setListening(false);
  }

  function toggleListening() {
    if (recognition.current) { stopListening(); return; }
    setVoiceError(null);
    const speechWindow = window as unknown as { SpeechRecognition?: new () => VoiceRecognition; webkitSpeechRecognition?: new () => VoiceRecognition };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceError("Voice input is unavailable in this browser. You can type your message instead."); return; }
    let started = false;
    const session = startVoiceInput({ create: () => new SpeechRecognition(), value, language, onChange,
      onListening: next => { started = next; setListening(next); if (!next) recognition.current = null; }, onStatus: setVoiceError });
    recognition.current = started ? session : null;
  }

  function submit() {
    if (!canSend) return;
    stopListening();
    onSend();
  }

  return <LayoutGroup id={id}><div className="relative min-w-0">
    <AnimatePresence initial={false}>
      {!engaged ? <motion.div key="welcome" initial={{ opacity: 0, height: 0, marginBottom: 0 }} animate={{ opacity: 1, height: "auto", marginBottom: 16 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }} transition={{ duration: reduceMotion ? 0 : 0.3 }} className="flex items-center gap-3">
        <motion.div layoutId="agent-composer-mascot" transition={mascotTransition} className="relative z-20 shrink-0">{mascot}</motion.div>
      </motion.div> : null}
    </AnimatePresence>
    <motion.div initial={false} animate={{ paddingTop: engaged ? 60 : 0 }} transition={mascotTransition} className="relative">
      {engaged ? <motion.div layoutId="agent-composer-mascot" transition={mascotTransition} className="pointer-events-none absolute top-0 right-4 z-20">{mascot}</motion.div> : null}
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="ai-composer relative rounded-3xl border border-border/90 bg-card p-4 shadow-[0_12px_35px_rgba(0,0,0,.06)] transition-shadow focus-within:border-ring/60 focus-within:shadow-[0_16px_40px_rgba(0,0,0,.09)] motion-reduce:transition-none">
      <label htmlFor={id} className="sr-only">{label}</label>
      <AiImagePreviews images={attachments.images} onRemove={attachments.remove} disabled={busy || attachments.processing} />
      <AiImageFeedback attachments={attachments} />
      <textarea ref={inputRef} id={id} aria-describedby={`${id}-context ${id}-hint`} value={value} onChange={(event) => { stopListening(); setVoiceError(null); onChange(event.target.value); }} onPaste={busy ? undefined : attachments.onPaste} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
      }} placeholder={listening && active && !busy ? "Listening to your voice…" : busy ? "Thinking…" : placeholder} disabled={busy} rows={2} maxLength={6_000} className="block max-h-64 min-h-16 w-full resize-none overflow-y-auto bg-transparent pb-3 text-base leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:opacity-60 sm:text-sm" />
      <div className="ai-composer-toolbar border-t border-border/70 pt-3">
        {children}
        <div className="ai-composer-optional-actions [&>button]:rounded-xl [&>button]:px-2 [&>button:not([aria-pressed=true])]:border-transparent">
          <AiImagePicker attachments={attachments} disabled={busy} />
          <WebSearchOption enabled={webSearch} onChange={onWebSearchChange} disabled={busy} />
        </div>
        <div className="ai-composer-submit-actions">
          <button type="button" disabled={busy} onClick={toggleListening} aria-label={listening && active && !busy ? "Stop voice input" : "Dictate with voice"} aria-pressed={listening && active && !busy} title="Voice input" className={`grid size-9 place-items-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${listening && active && !busy ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}><Mic aria-hidden="true" className="size-4" /></button>
          <button type={busy ? "button" : "submit"} onClick={busy && canStop ? onCancel : undefined} disabled={busy ? !canStop : !canSend} aria-label={busy ? canStop ? "Stop AI response" : "Agent action in progress" : "Send to Filazoo AI"} title={busy ? canStop ? "Stop response" : "Agent action in progress" : "Send message (Enter)"} className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:bg-muted disabled:text-muted-foreground ${busy ? "bg-amber-400/20 text-amber-600" : "bg-foreground text-background hover:bg-foreground/85"}`}>{busy ? <Square aria-hidden="true" className="size-3.5 fill-current" /> : <ArrowUp aria-hidden="true" className="size-4" />}</button>
        </div>
      </div>
      {listening && active && !busy ? <p role="status" className="mt-2 text-xs text-muted-foreground">Listening…</p> : null}
      {voiceError ? <p role="status" className="mt-2 text-xs text-muted-foreground">{voiceError}</p> : null}
    </form>
    </motion.div>
  </div></LayoutGroup>;
}
