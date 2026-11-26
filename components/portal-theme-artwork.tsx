import { type CSSProperties } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import type { PortalDesign } from "@/lib/portal-design";
import { portalAccentForeground } from "@/lib/portal-design-defaults";
import { portalWebsiteDesign } from "@/lib/portal-website-design";
import { websiteBinding, websiteSectionBlocks } from "@/lib/portal-website-blocks";

export function PortalThemeArtwork({ design }: { design: PortalDesign }) {
  const website = portalWebsiteDesign(design);
  const home = website.pages.find(page => page.id === "home");
  const hero = home?.sections.find(section => section.enabled && section.type === "hero");
  const pages = website.pages.filter(page => page.enabled && page.id !== "home");
  const blocks = hero ? websiteSectionBlocks(hero, { brandName: design.brandName, supportEmail: design.supportEmail, pages: website.pages, pageId: "home" }) : [];
  const heading = websiteBinding(blocks, "title");
  const body = websiteBinding(blocks, "body");
  return <div className="pta pta-website" data-theme={design.theme} style={{ "--pta-accent": design.accent, "--pta-on-accent": portalAccentForeground(design.accent) } as CSSProperties} aria-hidden="true">
    <header className="pta-website-header"><div className="pta-brand"><i>{design.brandName[0]}</i><strong>{design.brandName}</strong></div><nav><span>Home</span>{pages.slice(0, 2).map(page => <span key={page.id}>{page.title}</span>)}</nav><UserRound /></header>
    <div className="pta-website-hero" style={{ textAlign: hero?.alignment, backgroundColor: hero?.style?.background || undefined, color: hero?.style?.color || undefined }}><small>{design.brandName} · B2B</small><strong>{hero ? heading?.text ?? hero.title : home?.sections.find(section => section.enabled)?.title ?? design.brandName}</strong><p>{body?.text ?? hero?.body}</p>{hero?.buttonLabel && <span>{hero.buttonLabel}<ArrowRight /></span>}</div>
    <div className="pta-website-pages">{pages.slice(0, 3).map(page => <div key={page.id}>{page.title}<ArrowRight /></div>)}</div>
  </div>;
}
