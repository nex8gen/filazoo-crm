import { type CSSProperties } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import type { PortalDesign } from "@/lib/portal-design";

export function PortalThemeArtwork({ design }: { design: PortalDesign }) {
  const home = design.website?.pages.find(page => page.id === "home");
  const hero = home?.sections.find(section => section.enabled && section.type === "hero");
  const pages = design.website?.pages.filter(page => page.enabled && page.id !== "home") ?? [{ id: "about", title: "About us" }, { id: "contact", title: "Contact" }];
  return <div className="pta pta-website" data-theme={design.theme} style={{ "--pta-accent": design.accent } as CSSProperties} aria-hidden="true">
    <header className="pta-website-header"><div className="pta-brand"><i>{design.brandName[0]}</i><strong>{design.brandName}</strong></div><nav><span>Home</span>{pages.slice(0, 2).map(page => <span key={page.id}>{page.title}</span>)}</nav><UserRound /></header>
    <div className="pta-website-hero"><small>{design.brandName} · B2B</small><strong>{hero?.title ?? `Welcome to ${design.brandName}`}</strong><p>{hero?.body ?? "Discover our business and get in touch to discuss your requirements."}</p><span>{hero?.buttonLabel || "Contact us"}<ArrowRight /></span></div>
    <div className="pta-website-pages">{pages.slice(0, 3).map(page => <div key={page.id}>{page.title}<ArrowRight /></div>)}</div>
  </div>;
}
