"use client";

import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { ArrowRight, Building2, UserRound } from "lucide-react";
import { portalAccentForeground } from "@/lib/portal-design";
import { portalWebsiteDesign, type PublicWebsiteDesign } from "@/lib/portal-website-design";
import { safeWebsiteLink, websiteSectionBlocks } from "@/lib/portal-website-blocks";
import { PortalWebsiteElements, PortalWebsiteSlideshow } from "@/components/portal-website-elements";
import "./portal-website.css";

export function PortalWebsite({ design, page = "home", preview = false, onPageChange, selectedSection, onSectionSelect, selectedElement, onElementSelect }: {
  design: PublicWebsiteDesign; page?: string; preview?: boolean; onPageChange?: (page: string) => void;
  selectedSection?: string; onSectionSelect?: (id: string) => void;
  selectedElement?: { sectionId: string; path: number[] }; onElementSelect?: (sectionId: string, path: number[]) => void;
}) {
  const website = portalWebsiteDesign(design);
  const current = website.pages.find(item => item.id === (page === "home" ? "home" : page.replace(/^pages\//, "")) && (preview || item.enabled));
  const pages = website.pages.filter(item => item.enabled);
  const showBrand = website.header?.showBrand ?? !design.logoUrl;
  const navigation = (website.navigation?.filter(item => item.enabled) ?? pages.map(item => ({ id: item.id, label: item.id === "home" ? "Home" : item.title, link: item.id === "home" ? "home" : `pages/${item.id}`, enabled: true }))).filter(item => !item.link.startsWith("pages/") || pages.some(page => `pages/${page.id}` === item.link));
  function destination(id: string, children: ReactNode, className = "") {
    if (preview && /^(home|account|pages\/)/.test(id)) return <button type="button" className={className} onClick={() => onPageChange?.(id)}>{children}</button>;
    const href = safeWebsiteLink(id);
    return href ? <a className={className} href={href}>{children}</a> : <span className={className}>{children}</span>;
  }
  function editHandle(id: string, title: string) {
    return preview && onSectionSelect ? <button type="button" className="pws-edit-handle" aria-label={`Edit ${title} section`} onClick={() => onSectionSelect(id)}>{title}</button> : null;
  }
  const style = { "--pws-accent": design.accent, "--pws-on-accent": portalAccentForeground(design.accent) } as CSSProperties;
  return <div className="portal-website" data-theme={design.theme} data-preview={preview || undefined} style={style}>
    {!preview && <a href="#website-content" className="portal-skip-link">Skip to content</a>}
    {design.announcement && <div className="pws-announcement pws-editable" data-selected={selectedSection === "announcement"}>{editHandle("announcement", "Announcement bar")}{design.announcement}</div>}
    {website.header?.enabled !== false && <header className="pws-header pws-editable" data-selected={selectedSection === "header" || selectedSection?.startsWith("header/")} data-sticky={website.header?.sticky || undefined} style={{ backgroundColor: website.header?.background || undefined, color: website.header?.color || undefined, paddingBlock: website.header?.padding, "--pws-logo-width": `${website.header?.logoWidth ?? 150}px` } as CSSProperties}>
      {editHandle("header", "Header")}
      {(showBrand || (design.logoUrl && website.header?.showLogo !== false)) && destination("home", <>{design.logoUrl && website.header?.showLogo !== false ? <Image src={design.logoUrl} alt={design.brandName} width={website.header?.logoWidth ?? 150} height={42} unoptimized referrerPolicy="no-referrer" /> : showBrand && <span className="pws-brand-symbol">{design.brandName.slice(0, 1)}</span>}{showBrand && <strong>{design.brandName}</strong>}</>, "pws-brand")}
      {website.header?.showNavigation !== false && <nav aria-label="Website pages">{navigation.map(item => <span key={item.id} aria-current={(current?.id === "home" ? "home" : `pages/${current?.id}`) === item.link ? "page" : undefined}>{destination(item.link, item.label)}</span>)}</nav>}
      {website.header?.showAccount !== false && destination("account", <><UserRound /><span>{website.header?.accountLabel ?? "Customer account"}</span></>, "pws-account")}
    </header>}
    <main id="website-content" className="pws-content">
      {!current && <section className="pws-empty"><h1>This page isn’t available</h1>{destination("home", <>Back to home<ArrowRight /></>, "pws-button")}</section>}
      {current?.sections.filter(section => section.enabled).map(section => <section key={section.id} id={`section-${section.id}`} className={`pws-section pws-${section.type} pws-editable`} data-mobile-height={section.style?.mobileHeight !== undefined || undefined} data-selected={selectedSection === section.id} data-alignment={section.alignment} data-desktop={section.style?.desktopVisible ?? true} data-mobile={section.style?.mobileVisible ?? true} data-image-position={section.style?.imagePosition ?? "left"} data-custom-color={Boolean(section.style?.color)}
        style={{ "--pws-align-items": section.alignment === "center" ? "center" : "start", "--pws-section-height": `${section.height}px`, "--pws-mobile-height": `${section.style?.mobileHeight ?? section.height}px`, "--pws-content-width": `${section.style?.maxWidth ?? 1100}px`, "--pws-section-columns": section.style?.columns ?? (section.type === "image" ? 2 : 1), "--pws-mobile-columns": section.style?.mobileColumns ?? 1, "--pws-section-gap": `${section.style?.gap ?? 20}px`, "--pws-overlay": (section.style?.overlay ?? 42) / 100,
          paddingTop: section.style?.paddingTop, paddingBottom: section.style?.paddingBottom, paddingInline: section.style?.paddingX,
          backgroundColor: section.style?.background || undefined, color: section.style?.color || undefined,
          "--pws-heading-size": section.style?.headingSize ? `${section.style.headingSize}px` : undefined, "--pws-text-size": section.style?.textSize ? `${section.style.textSize}px` : undefined,
          alignItems: section.style?.contentPosition,
        } as CSSProperties}>
        {editHandle(section.id, section.title || section.type)}
        {(section.type === "hero" || section.type === "banner") && section.imageUrl && <div className="pws-section-image"><Image src={section.imageUrl} alt="" fill unoptimized referrerPolicy="no-referrer" sizes="100vw" /></div>}
        <div className="pws-section-copy pws-elements" data-section-layout={section.type}>
          {(() => {
            const Renderer = section.type === "slideshow" ? PortalWebsiteSlideshow : PortalWebsiteElements;
            return <Renderer blocks={websiteSectionBlocks(section, { brandName: design.brandName, supportEmail: design.supportEmail, pages: website.pages, pageId: current.id })} section={section} preview={preview} selected={selectedElement?.sectionId === section.id ? selectedElement.path.join(".") : undefined} onSelect={onElementSelect ? path => onElementSelect(section.id, path) : undefined} onNavigate={onPageChange} />;
          })()}
        </div>
      </section>)}
      {preview && current?.sections.every(section => !section.enabled) && <div className="pws-empty"><Building2 /><h2>Add your first section</h2><p>Build this page using the sections panel.</p></div>}
    </main>
    {website.footer?.enabled !== false && <footer className="pws-footer pws-editable" data-selected={selectedSection === "footer" || selectedSection?.startsWith("footer/")} style={{ backgroundColor: website.footer?.background || undefined, color: website.footer?.color || undefined, paddingBlock: website.footer?.padding }}>{editHandle("footer", "Footer")}{website.footer?.showBrand !== false && <strong>{design.brandName}</strong>}{design.footer && <p>{design.footer}</p>}{website.footer?.showNavigation && <nav aria-label="Footer navigation">{navigation.map(item => <span key={item.id}>{destination(item.link, item.label)}</span>)}</nav>}{website.footer?.showEmail !== false && design.supportEmail && <a href={`mailto:${design.supportEmail}`}>{design.supportEmail}</a>}</footer>}
  </div>;
}
