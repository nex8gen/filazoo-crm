"use client";

import { useState, type DragEvent } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, ChevronDown, GripVertical, Link2, Minus, Plus, Scan, Trash2, Rows2, Columns2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditorColorControl, EditorNumberControl, EditorSelect } from "@/components/email-editor-controls";
import { emailSocialAssets } from "@/lib/email-social-assets";
import { emailSocialAsset, emailSocialPlatform, emailSocialSettings, moveEmailSocialLink, newEmailSocialLink, type EmailSocialLink, type EmailSocialPlatform } from "@/lib/email-social";
import type { EmailBlock } from "@/lib/email-design";
import { BlockPaddingControl, BlockSection, BlockTypography } from "@/components/email-block-controls";
import { blockInsets, blockPresentation } from "@/lib/email-block-config";
import "./email-social-editor.css";

const dragType = "application/x-filazoo-social-link";

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="editor-switchRow"><span>{label}</span><span className="editor-switch"><input type="checkbox" aria-label={label} checked={checked} onChange={event => onChange(event.target.checked)} /><span aria-hidden="true" /></span></label>;
}

export function EmailSocialEditor({ block, onChange }: { block: EmailBlock; onChange: (update: Partial<EmailBlock>) => void }) {
  const [tab, setTab] = useState("styles");
  const [paddingLinked, setPaddingLinked] = useState(true);
  const [fourSides, setFourSides] = useState(Boolean(block.presentation?.padding));
  const presentation = blockPresentation(block);
  const [over, setOver] = useState<number | null>(null);
  const settings = emailSocialSettings(block);
  function style(update: Partial<typeof settings>) { onChange({ social: { ...settings, ...update }, ...("paddingX" in update || "paddingY" in update ? { presentation: { ...block.presentation, padding: undefined } } : {}) }); }
  function updateLink(index: number, update: Partial<EmailSocialLink>) { onChange({ links: block.links.map((link, i) => i === index ? { ...link, ...update } : link) }); }
  function move(from: number, to: number) { onChange({ links: moveEmailSocialLink(block.links, from, to) }); }
  function add(spacer: boolean) {
    const next = emailSocialAssets.find(item => item.id !== "custom" && !block.links.some(link => link.kind !== "spacer" && emailSocialPlatform(link) === item.id))?.id ?? "custom";
    onChange({ links: [...block.links, newEmailSocialLink(next, spacer)] });
  }
  function drop(event: DragEvent, to: number) {
    event.preventDefault(); event.stopPropagation(); setOver(null);
    try {
      const data = JSON.parse(event.dataTransfer.getData(dragType));
      if (data.blockId !== block.id) return;
      const from = data.id ? block.links.findIndex(link => link.id === data.id) : data.index;
      move(from, to);
    } catch { /* A file or a block from the canvas is not a social link. */ }
  }
  return <div className="email-social-editor">
    <nav className="email-social-tabs" aria-label="Social link settings">
      <button type="button" aria-pressed={tab === "styles"} onClick={() => setTab("styles")}>Styles</button>
      <button type="button" aria-pressed={tab === "display"} onClick={() => setTab("display")}>Display</button>
    </nav>
    {tab === "display" ? <BlockSection title="Display options"><Switch label="Show on desktop" checked={settings.showDesktop} onChange={showDesktop => style({ showDesktop })} /><Switch label="Show on mobile" checked={settings.showMobile} onChange={showMobile => style({ showMobile })} /><p className="email-social-hint">Hidden blocks stay editable here. Preview shows the visibility you choose.</p></BlockSection> : <>
      <BlockSection title="Content">
        <div className="email-social-cards">{block.links.map((item, index) => {
          const platform = emailSocialPlatform(item), spacer = item.kind === "spacer";
          const title = spacer ? "Spacer" : item.label || emailSocialAssets.find(asset => asset.id === platform)!.label;
          return <details className="email-social-card" key={item.id ?? index} data-social-index={index} data-drag-over={over === index || undefined} onDragOver={event => { if (event.dataTransfer.types.includes(dragType)) { event.preventDefault(); event.stopPropagation(); setOver(index); } }} onDragLeave={() => setOver(null)} onDrop={event => drop(event, index)}>
            <summary>
              <button type="button" className="email-social-drag" draggable aria-label={`Reorder ${title} ${index + 1}`} title="Drag to reorder, or use the up and down arrow keys" onClick={event => event.preventDefault()} onDragStart={event => { event.dataTransfer.setData(dragType, JSON.stringify({ blockId: block.id, id: item.id, index })); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setOver(null)} onKeyDown={event => { if (["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); move(index, index + (event.key === "ArrowUp" ? -1 : 1)); } }}><GripVertical /></button>
              <ChevronDown /><span>{title}</span>
              <Button size="icon-xs" variant="ghost" aria-label={`Remove ${title} ${index + 1}`} title={`Remove ${title}`} onClick={event => { event.preventDefault(); onChange({ links: block.links.filter((_, i) => i !== index) }); }}><Trash2 /></Button>
            </summary>
            <div className="email-social-cardBody">{spacer ? <EditorNumberControl compact label={`Spacer ${index + 1} width`} value={item.spacerWidth ?? 16} max={80} onChange={spacerWidth => updateLink(index, { spacerWidth })} /> : <>
              <EditorSelect compact label={`Link ${index + 1} platform`} value={platform} options={emailSocialAssets.map(asset => ({ value: asset.id, label: asset.label, iconSrc: asset.images.brand }))} onChange={value => {
                const chosen = emailSocialAssets.find(asset => asset.id === value)!;
                const previous = emailSocialAssets.find(asset => asset.id === platform)!;
                updateLink(index, { platform: value as EmailSocialPlatform, ...(!item.label || item.label === previous.label ? { label: chosen.label } : {}) });
              }} />
              <label className="email-designer-field">Label<Input aria-label={`Link ${index + 1} label`} value={item.label} maxLength={80} onChange={event => updateLink(index, { label: event.target.value })} /></label>
              <label className="email-designer-field">Link URL<Input aria-label={`Link ${index + 1} URL`} value={item.href} maxLength={2000} placeholder={platform === "email" ? "mailto:hello@example.com" : "https://"} onChange={event => updateLink(index, { href: event.target.value })} /></label>
              {platform === "custom" ? <label className="email-designer-field">Custom icon image URL<Input aria-label={`Link ${index + 1} icon URL`} value={item.customSrc ?? ""} maxLength={2000} placeholder="https://example.com/icon.png" onChange={event => updateLink(index, { customSrc: event.target.value })} /></label> : null}
              <div className="email-social-iconSample" aria-label={`${title} icon preview`} style={{ backgroundImage: `url(${platform === "custom" && item.customSrc && /^https?:\/\//i.test(item.customSrc) ? JSON.stringify(item.customSrc) : JSON.stringify(emailSocialAsset(platform, settings.iconColor))})` }} />
            </>}
              <div className="email-social-moveButtons"><Button size="icon-xs" variant="ghost" aria-label={`Move item ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp /></Button><Button size="icon-xs" variant="ghost" aria-label={`Move item ${index + 1} down`} title="Move down" disabled={index === block.links.length - 1} onClick={() => move(index, index + 1)}><ArrowDown /></Button></div>
            </div>
          </details>;
        })}</div>
        <div className="email-social-add"><Button size="sm" variant="outline" disabled={block.links.length >= 10} onClick={() => add(false)}>Add icon</Button><Button size="sm" variant="outline" disabled={block.links.length >= 10} onClick={() => add(true)}>Add spacer</Button></div>
        {block.links.length >= 10 ? <p className="email-social-hint">Up to 10 icons and spacers per block.</p> : null}
      </BlockSection>
      <section className="email-social-section"><button className="email-social-sectionToggle" type="button" aria-expanded={settings.showLabels} onClick={() => style({ showLabels: !settings.showLabels })}><span>Text labels</span>{settings.showLabels ? <Minus /> : <Plus />}</button>
        {settings.showLabels ? <div className="email-social-labelControls"><BlockTypography block={block} onChange={onChange} extra={presentation} onExtraChange={values => onChange({ presentation: { ...block.presentation, ...values } })} /></div> : null}
      </section>
      <BlockSection title="Icon styles"><div className="email-social-grid"><EditorSelect compact label="Icon size" value={settings.iconSize} options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} onChange={iconSize => style({ iconSize: iconSize as typeof settings.iconSize })} /><EditorSelect compact label="Icon color" value={settings.iconColor} options={[{ value: "brand", label: "Brand colors" }, { value: "black", label: "Black" }, { value: "white", label: "White" }]} onChange={iconColor => style({ iconColor: iconColor as typeof settings.iconColor })} /></div>
        <div className="email-social-grid"><div className="email-designer-format" role="group" aria-label="Social alignment">{[{ value: "left", icon: AlignLeft }, { value: "center", icon: AlignCenter }, { value: "right", icon: AlignRight }].map(item => <Button key={item.value} size="icon-sm" variant="ghost" aria-label={`Align ${item.value}`} aria-pressed={block.align === item.value} onClick={() => onChange({ align: item.value as EmailBlock["align"] })}><item.icon /></Button>)}</div><EditorNumberControl compact label="Icon spacing" value={settings.gap} max={80} onChange={gap => style({ gap })} /></div>
        <Switch label="Stack on mobile" checked={settings.stackMobile} onChange={stackMobile => style({ stackMobile })} />
      </BlockSection>
      <BlockSection title="Block background color" collapsed={block.background === "transparent"}><EditorColorControl compact label="Background color" transparent value={block.background} onChange={background => onChange({ background })} /></BlockSection>
      <BlockSection title="Block padding"><div className="email-social-sectionHeading"><span>Edit padding</span><Button variant="ghost" size="icon-sm" aria-label="Edit social padding individual sides" aria-pressed={fourSides} onClick={() => setFourSides(!fourSides)}><Scan /></Button></div>{fourSides ? <BlockPaddingControl label="Block padding" individualSides value={blockInsets(block)} onChange={padding => onChange({ presentation: { ...block.presentation, padding } })} /> : <div className="email-social-padding"><EditorNumberControl compact prefix={<Rows2 />} label="Vertical padding" value={settings.paddingY ?? block.padding} max={80} onChange={paddingY => style({ paddingY, ...(paddingLinked ? { paddingX: paddingY } : {}) })} /><EditorNumberControl compact prefix={<Columns2 />} label="Horizontal padding" value={settings.paddingX ?? block.padding} max={80} onChange={paddingX => style({ paddingX, ...(paddingLinked ? { paddingY: paddingX } : {}) })} /><Button size="icon-sm" variant="ghost" title={paddingLinked ? "Unlink padding" : "Link padding"} aria-label="Link padding values" aria-pressed={paddingLinked} onClick={() => setPaddingLinked(!paddingLinked)}><Link2 /></Button></div>}</BlockSection>
    </>}
  </div>;
}
