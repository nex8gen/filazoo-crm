"use client";

import { useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Underline, Strikethrough, Scan, Plus, Minus, Rows2, Columns2, PanelTop, PanelRight, PanelBottom, PanelLeft, ALargeSmall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorColorControl, EditorNumberControl, EditorSelect } from "@/components/email-editor-controls";
import { emailFonts, type EmailInsets, noBorder } from "@/lib/email-block-config";
import type { EmailBlock } from "@/lib/email-design";
import "./email-block-controls.css";

export function BlockSection({ title, children, collapsed = false }: { title: string; children: ReactNode; collapsed?: boolean }) {
  // The setting only determines the initial state. Editing a value must not
  // reopen a section the user closed, or close the controls being edited.
  const [open, setOpen] = useState(!collapsed);
  return <details className="email-block-section" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{title}<Plus aria-hidden="true" className="email-block-expand" /><Minus aria-hidden="true" className="email-block-collapse" /></summary><div>{children}</div></details>;
}
export function BlockSwitch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="editor-switchRow"><span>{label}</span><span className="editor-switch"><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span aria-hidden="true" /></span></label>;
}
export function BlockPaddingControl({ label, value, onChange, individualSides = false }: { label: string; value: EmailInsets; onChange: (value: EmailInsets) => void; individualSides?: boolean }) {
  const [expanded, setExpanded] = useState(individualSides);
  const individual = expanded || value.top !== value.bottom || value.left !== value.right;
  return <div className="email-block-padding"><div className="email-block-grid">
    {individual ? (["top", "right", "bottom", "left"] as const).map(side => { const Icon = { top: PanelTop, right: PanelRight, bottom: PanelBottom, left: PanelLeft }[side]; return <EditorNumberControl key={side} compact prefix={<Icon />} label={`${label} ${side}`} value={value[side]} max={80} onChange={next => onChange({ ...value, [side]: next })} />; }) : <><EditorNumberControl compact prefix={<Rows2 />} label={`${label} vertical`} value={value.top} max={80} onChange={next => onChange({ ...value, top: next, bottom: next })} /><EditorNumberControl compact prefix={<Columns2 />} label={`${label} horizontal`} value={value.left} max={80} onChange={next => onChange({ ...value, left: next, right: next })} /></>}
  </div><Button variant="ghost" size="icon-sm" title="Edit individual sides" aria-label={`Edit ${label.toLowerCase()} individual sides`} aria-pressed={individual} onClick={() => { if (individual) onChange({ top: value.top, bottom: value.top, left: value.left, right: value.left }); setExpanded(!individual); }}><Scan /></Button></div>;
}
export function BlockBorderControl({ label = "Border", value, onChange }: { label?: string; value: { style: "none" | "solid" | "dashed" | "dotted" | "double"; width: number; color: string }; onChange: (next: typeof value) => void }) {
  return <BlockSection title={label} collapsed={value.style === "none"}><div className="email-block-grid"><EditorSelect compact label={`${label} style`} value={value.style} options={["none", "solid", "dashed", "dotted", "double"].map(style => ({ value: style, label: style[0].toUpperCase() + style.slice(1) }))} onChange={style => onChange({ ...value, style: style as typeof value.style, width: style !== "none" && !value.width ? 1 : value.width })} /><EditorNumberControl compact label={`${label} width`} value={value.width} max={20} onChange={width => onChange({ ...value, width, style: width && value.style === "none" ? "solid" : value.style })} /></div><EditorColorControl compact label={`${label} color`} value={value.color} onChange={color => onChange({ ...value, color })} /></BlockSection>;
}
export function BlockAlignment({ value, onChange, label = "Alignment" }: { value: "left" | "center" | "right"; onChange: (next: typeof value) => void; label?: string }) {
  return <div className="email-designer-format" role="group" aria-label={label}>{[{ value: "left", icon: AlignLeft }, { value: "center", icon: AlignCenter }, { value: "right", icon: AlignRight }].map(item => <Button key={item.value} variant="ghost" size="icon-sm" aria-label={`Align ${item.value}`} aria-pressed={value === item.value} onClick={() => onChange(item.value as typeof value)}><item.icon /></Button>)}</div>;
}
export function BlockTypography({ block, onChange, extra, onExtraChange }: { block: Pick<EmailBlock, "fontFamily" | "fontSize" | "color" | "bold" | "italic" | "underline">; onChange: (value: Partial<typeof block>) => void; extra: { letterSpacing: number; strike: boolean }; onExtraChange: (value: Partial<typeof extra>) => void }) {
  return <><EditorSelect compact label="Font" font value={block.fontFamily} options={emailFonts.map(font => ({ value: font, label: font }))} onChange={fontFamily => onChange({ fontFamily: fontFamily as EmailBlock["fontFamily"] })} /><div className="email-block-grid"><EditorNumberControl compact label="Font size" value={block.fontSize} min={8} max={64} onChange={fontSize => onChange({ fontSize })} /><EditorColorControl compact label="Text color" value={block.color} onChange={color => onChange({ color })} /></div><div className="email-block-typographyRow"><EditorNumberControl compact prefix={<ALargeSmall />} label="Letter spacing" step={0.1} value={extra.letterSpacing} min={-5} max={30} onChange={letterSpacing => onExtraChange({ letterSpacing })} /><div className="email-designer-textFormat" role="group" aria-label="Text formatting">{[{ key: "bold", icon: Bold }, { key: "italic", icon: Italic }, { key: "underline", icon: Underline }].map(item => <Button key={item.key} variant="ghost" size="icon-sm" aria-label={item.key} aria-pressed={block[item.key as "bold" | "italic" | "underline"]} onClick={() => onChange({ [item.key]: !block[item.key as "bold" | "italic" | "underline"] })}><item.icon /></Button>)}<Button variant="ghost" size="icon-sm" aria-label="strikethrough" aria-pressed={extra.strike} onClick={() => onExtraChange({ strike: !extra.strike })}><Strikethrough /></Button></div></div></>;
}
export { noBorder };
