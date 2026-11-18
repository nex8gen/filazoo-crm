"use client";

import { useId, type ReactNode } from "react";
import { BookOpen, Check, ChevronDown, MessageSquare, Settings2, SlidersHorizontal, UserRoundCheck } from "lucide-react";
import { FlowSenderField } from "@/components/flow-sender-field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { JsonConfig } from "@/lib/flows";
import "./flow-ai-reply-settings.css";

function SettingsGroup({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <details className="ai-reply-group">
    <summary><span className="ai-reply-group-icon" aria-hidden="true">{icon}</span><strong>{title}</strong><ChevronDown className="ai-reply-chevron" aria-hidden="true" /></summary>
    <div className="ai-reply-group-content">{children}</div>
  </details>;
}

function SettingSwitch({ label, detail, checked, onChange, disabled }: { label: string; detail?: string; checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  const id = useId();
  return <div className="ai-reply-switch-row" data-disabled={disabled || undefined}>
    <div><Label htmlFor={id}>{label}</Label>{detail ? <p id={`${id}-help`}>{detail}</p> : null}</div>
    <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={detail ? `${id}-help` : undefined} />
  </div>;
}

export function AiReplyInspector({ config, onChange, mailboxes, disabled }: { config: JsonConfig; onChange: (config: JsonConfig) => void; mailboxes: { id: string; label: string }[]; disabled: boolean }) {
  const id = useId();
  const set = (key: string, value: JsonConfig[string]) => onChange({ ...config, [key]: value });
  const qualify = config.leadIntake === true;

  return <div className="ai-reply-settings">
    <FlowSenderField compact value={String(config.mailboxId || "default")} onChange={value => set("mailboxId", value)} options={mailboxes} disabled={disabled} />

    <fieldset className="ai-reply-purpose"><legend>Reply goal</legend><div className="ai-reply-purpose-grid">
      {[{ value: false, title: "Answer questions", icon: MessageSquare }, { value: true, title: "Collect requirements", icon: UserRoundCheck }].map(({ value, title, icon: Icon }) => <label key={title} className="ai-reply-purpose-card" data-selected={qualify === value} data-disabled={disabled || undefined}>
        <input type="radio" name={`${id}-purpose`} value={String(value)} checked={qualify === value} disabled={disabled} aria-describedby={value ? `${id}-intake-help` : undefined} onChange={() => onChange({ ...config, leadIntake: value, ...(value ? { attachCatalog: true, useProducts: true, usePrices: false } : {}) })} />
        <span className="ai-reply-purpose-top"><Icon aria-hidden="true" /><span className="ai-reply-choice-mark" aria-hidden="true">{qualify === value ? <Check /> : null}</span></span><strong>{title}</strong>
      </label>)}
    </div><span id={`${id}-intake-help`} className="sr-only">Introduce your business and ask for missing requirements. Selecting this goal enables product information and catalog attachments, and turns price quotes off.</span></fieldset>

    <SettingsGroup icon={<SlidersHorizontal />} title="Instructions">
      <div className="ai-reply-field"><Label className="sr-only" htmlFor={`${id}-instructions`}>Reply instructions</Label><Textarea id={`${id}-instructions`} value={String(config.instructions || "")} onChange={event => set("instructions", event.target.value)} maxLength={4000} placeholder="e.g. Ask about quantities and delivery dates." disabled={disabled} /></div>
      {qualify ? <div className="ai-reply-field"><Label htmlFor={`${id}-introduction`}>Company introduction</Label><Textarea id={`${id}-introduction`} maxLength={4000} value={String(config.introductionTemplate || "")} onChange={event => set("introductionTemplate", event.target.value)} placeholder="Leave blank to use the default introduction." disabled={disabled} /></div> : null}
    </SettingsGroup>

    <SettingsGroup icon={<BookOpen />} title="Products & catalog">
      <SettingSwitch checked={Boolean(config.useProducts)} onChange={value => onChange({ ...config, useProducts: value, ...(!value ? { usePrices: false } : {}) })} label="Product information" disabled={disabled} />
      <SettingSwitch checked={Boolean(config.usePrices)} onChange={value => set("usePrices", value)} label="Quote saved prices" detail={!config.useProducts ? "Enable product information first." : undefined} disabled={disabled || !config.useProducts} />
      <SettingSwitch checked={Boolean(config.attachCatalog)} onChange={value => set("attachCatalog", value)} label="Send catalog when relevant" disabled={disabled} />
      {config.attachCatalog ? <div className="ai-reply-nested"><SettingSwitch checked={config.catalogFirstMessageOnly !== false} onChange={value => set("catalogFirstMessageOnly", value)} label="Also attach to the first reply" disabled={disabled} /></div> : null}
    </SettingsGroup>

    <SettingsGroup icon={<Settings2 />} title="Delivery & tracking">
      <div className="ai-reply-field"><Label htmlFor={`${id}-window`}>When to send</Label><Select value={String(config.sendWindow || "anytime")} onValueChange={value => value && set("sendWindow", value)} disabled={disabled}><SelectTrigger id={`${id}-window`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="anytime">Any time</SelectItem><SelectItem value="business_hours">Business hours (09:00–17:00 UTC)</SelectItem></SelectContent></Select></div>
      <SettingSwitch checked={config.replyInThread !== false} onChange={value => set("replyInThread", value)} label="Keep replies in the same thread" disabled={disabled} />
      <SettingSwitch checked={config.stopOnReply === true} onChange={value => set("stopOnReply", value)} label="Skip if a new reply arrives" disabled={disabled} />
      <SettingSwitch checked={config.trackOpens !== false} onChange={value => set("trackOpens", value)} label="Track email opens" disabled={disabled} />
      <SettingSwitch checked={config.trackClicks !== false} onChange={value => set("trackClicks", value)} label="Track link clicks" disabled={disabled} />
      <SettingSwitch checked={config.utmTracking !== false} onChange={value => set("utmTracking", value)} label="Tag links for website analytics" disabled={disabled} />
    </SettingsGroup>

  </div>;
}
