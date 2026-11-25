"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PortalEditorSelect } from "@/components/portal-editor-select";
import { EditorColor, EditorRange, EditorSettingsGroup, EditorToggle } from "@/components/portal-editor-fields";
import type { PortalWebsiteSection, WebsiteSectionStyle } from "@/lib/portal-design";

export function PortalSectionAppearance({ section, onChange }: { section: PortalWebsiteSection; onChange: (patch: Partial<PortalWebsiteSection>) => void }) {
  const style = section.style ?? {};
  const update = (patch: Partial<WebsiteSectionStyle>) => onChange({ style: { ...style, ...patch } });
  return <>
    <EditorSettingsGroup title="Section layout">
      <EditorRange label="Content width" min={320} max={1600} step={20} value={style.maxWidth ?? 1100} onChange={maxWidth => update({ maxWidth })} />
      <EditorRange label="Space between elements" min={0} max={64} value={style.gap ?? 20} onChange={gap => update({ gap })} />
      <EditorRange label="Top padding" min={0} max={160} step={4} value={style.paddingTop ?? 64} onChange={paddingTop => update({ paddingTop })} />
      <EditorRange label="Bottom padding" min={0} max={160} step={4} value={style.paddingBottom ?? 64} onChange={paddingBottom => update({ paddingBottom })} />
      <EditorRange label="Side padding" min={0} max={120} step={4} value={style.paddingX ?? 48} onChange={paddingX => update({ paddingX })} />
      {section.type === "image" && <Label className="pb-field">Image position<PortalEditorSelect label="Section image position" value={style.imagePosition ?? "left"} options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} onChange={imagePosition => update({ imagePosition: imagePosition as "left" | "right" })} /></Label>}
      {["hero", "banner"].includes(section.type) && <Label className="pb-field">Vertical alignment<PortalEditorSelect label="Section vertical alignment" value={style.contentPosition ?? "center"} options={[{ value: "start", label: "Top" }, { value: "center", label: "Center" }, { value: "end", label: "Bottom" }]} onChange={contentPosition => update({ contentPosition: contentPosition as WebsiteSectionStyle["contentPosition"] })} /></Label>}
    </EditorSettingsGroup>
    <EditorSettingsGroup title="Colors & typography">
      <EditorColor label="Section background" value={style.background ?? ""} fallback="#ffffff" onChange={background => update({ background })} />
      <EditorColor label="Section text color" value={style.color ?? ""} onChange={color => update({ color })} />
      <EditorRange label="Section heading size" min={20} max={96} value={style.headingSize ?? (section.type === "hero" ? 60 : 36)} onChange={headingSize => update({ headingSize })} />
      <EditorRange label="Section text size" min={10} max={32} value={style.textSize ?? 15} onChange={textSize => update({ textSize })} />
      {section.imageUrl && ["hero", "banner"].includes(section.type) && <EditorRange label="Image overlay" min={0} max={80} unit="%" value={style.overlay ?? 42} onChange={overlay => update({ overlay })} />}
    </EditorSettingsGroup>
    {section.type === "slideshow" && <EditorSettingsGroup title="Slideshow"><EditorToggle label="Auto-rotate slides" checked={style.autoPlay ?? false} onChange={autoPlay => update({ autoPlay })} /><EditorRange label="Slide interval" min={3} max={15} unit="seconds" value={style.slideInterval ?? 5} onChange={slideInterval => update({ slideInterval })} /></EditorSettingsGroup>}
    <EditorSettingsGroup title="Mobile & visibility"><EditorRange label="Mobile section height" min={160} max={900} step={10} value={style.mobileHeight ?? section.height} onChange={mobileHeight => update({ mobileHeight })} /><EditorRange label="Mobile columns" min={1} max={2} unit="" value={style.mobileColumns ?? 1} onChange={mobileColumns => update({ mobileColumns })} /><EditorToggle label="Section on desktop" checked={style.desktopVisible ?? true} onChange={desktopVisible => update({ desktopVisible })} /><EditorToggle label="Section on mobile" checked={style.mobileVisible ?? true} onChange={mobileVisible => update({ mobileVisible })} /></EditorSettingsGroup>
    <Button type="button" variant="ghost" size="sm" disabled={!section.style} onClick={() => onChange({ style: undefined })}>Reset section styling</Button>
  </>;
}
