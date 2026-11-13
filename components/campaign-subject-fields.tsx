"use client";

import { useId, useRef, useState } from "react";
import { Smile, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { subjectVariationKinds, suggestCampaignSubject } from "@/lib/campaign-message-tools";
import type { CampaignConfig } from "@/lib/email-campaigns";

const emojis = ["😊", "✨", "🎉", "🎁", "🚀", "💡", "📣", "🔥", "⭐", "❤️", "👋", "✅", "📦", "🌟", "💬", "🙌", "🌱", "⏰", "💌", "🎯", "🔔", "💚", "🤝", "🆕"];
const variables = [{ key: "first_name", label: "First name" }, { key: "name", label: "Full name" }, { key: "company", label: "Company" }, { key: "email", label: "Email address" }];

function SubjectInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);
  function insert(text: string) {
    const range = selection.current ?? { start: value.length, end: value.length };
    const next = value.slice(0, range.start) + text + value.slice(range.end);
    if (next.length > 300) { toast.error("Keep the subject within 300 characters."); return; }
    onChange(next); setEmojiOpen(false); setPersonalizeOpen(false);
    const cursor = range.start + text.length;
    selection.current = { start: cursor, end: cursor };
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(cursor, cursor); });
  }
  return <div className="campaign-builder-field"><label htmlFor={id} className="campaign-builder-fieldLabel">{label}<span className="campaign-builder-required" aria-hidden="true">*</span></label><span className="campaign-builder-subjectInput"><Input id={id} ref={input} aria-label={label} required maxLength={300} placeholder="Add an email subject" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} onSelect={event => { selection.current = { start: event.currentTarget.selectionStart ?? value.length, end: event.currentTarget.selectionEnd ?? value.length }; }} /><Popover open={emojiOpen} onOpenChange={setEmojiOpen}><PopoverTrigger render={<Button type="button" variant="outline" size="icon" aria-label={`Add emoji to ${label}`} disabled={disabled}><Smile /></Button>} /><PopoverContent align="end" className="campaign-subject-emojiPicker" aria-label="Choose an emoji"><strong>Add emoji</strong><div>{emojis.map(emoji => <button type="button" key={emoji} aria-label={`Insert ${emoji}`} onClick={() => insert(emoji)}>{emoji}</button>)}</div></PopoverContent></Popover><Popover open={personalizeOpen} onOpenChange={setPersonalizeOpen}><PopoverTrigger render={<Button type="button" variant="outline" size="icon" aria-label={`Personalize ${label}`} disabled={disabled}><UserRound /></Button>} /><PopoverContent align="end" aria-label="Personalization fields"><strong>Personalize subject</strong>{variables.map(variable => <Button type="button" key={variable.key} variant="ghost" className="justify-between" onClick={() => insert(`{{${variable.key}}}`)}>{variable.label}<code className="text-xs text-muted-foreground">{`{{${variable.key}}}`}</code></Button>)}</PopoverContent></Popover></span></div>;
}

export function CampaignSubjectFields({ config, onChange, disabled }: { config: CampaignConfig; onChange: (value: Partial<CampaignConfig>) => void; disabled: boolean }) {
  return <>
    <SubjectInput label={config.subjectTest ? "Subject line A" : "Subject line"} value={config.subject} onChange={subject => onChange({ subject })} disabled={disabled} />
    {config.subjectTest ? <div className="campaign-builder-subjectTest"><div className="campaign-builder-subjectTestHeading"><strong>A/B subject test</strong><Button size="icon-xs" variant="ghost" aria-label="Remove A/B test" disabled={disabled} onClick={() => onChange({ subjectTest: undefined })}><X /></Button></div><SubjectInput label="Subject line B" value={config.subjectTest.subjectB} onChange={subjectB => onChange({ subjectTest: { subjectB } })} disabled={disabled} /><p>Each subject goes to half of the eligible recipients. The message stays the same.</p><strong>Create a variation to A/B test</strong><div className="campaign-builder-subjectSuggestions">{subjectVariationKinds.map(kind => <Button key={kind} type="button" variant="outline" size="xs" disabled={disabled || !config.subject.trim()} onClick={() => onChange({ subjectTest: { subjectB: suggestCampaignSubject(config.subject, kind) } })}>{kind}</Button>)}</div></div> : <div className="campaign-builder-subjectTest"><strong>Create a variation to A/B test</strong><div className="campaign-builder-subjectSuggestions">{subjectVariationKinds.map(kind => <Button key={kind} type="button" variant="outline" size="xs" disabled={disabled || !config.subject.trim()} onClick={() => onChange({ subjectTest: { subjectB: suggestCampaignSubject(config.subject, kind) } })}>{kind}</Button>)}</div></div>}
  </>;
}
