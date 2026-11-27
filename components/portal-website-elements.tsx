"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Building2, Check, Globe, ImageIcon, Mail, Package, ShieldCheck, Star, Truck } from "lucide-react";
import type { PortalWebsiteBlock, PortalWebsiteSection } from "@/lib/portal-design";
import { safeWebsiteLink } from "@/lib/portal-website-blocks";

const icons = { building: Building2, package: Package, truck: Truck, shield: ShieldCheck, check: Check, star: Star, mail: Mail, globe: Globe };
function inlineText(text: string, select?: () => void, basePath = ""): ReactNode {
  const expression = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  return text.split(expression).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    const href = link ? safeWebsiteLink(link[2], basePath) : undefined;
    return link && href ? <a key={index} href={href} onClick={select ? event => { event.preventDefault(); select(); } : undefined}>{link[1]}</a> : part;
  });
}
type ElementsProps = {
  blocks: PortalWebsiteBlock[]; section: PortalWebsiteSection; preview: boolean; selected?: string;
  parentPath?: number[]; basePath?: string; onSelect?: (path: number[]) => void; onNavigate?: (page: string) => void;
};

export function PortalWebsiteElements(props: ElementsProps) {
  return <>{props.blocks.map((block, index) => block.enabled ? <WebsiteElement key={block.id} {...props} block={block} path={[...(props.parentPath ?? []), index]} /> : null)}</>;
}

function WebsiteElement({ block, path, ...props }: ElementsProps & { block: PortalWebsiteBlock; path: number[] }) {
  const { section, preview, selected, onSelect, onNavigate } = props;
  const settings = block.style ?? {};
  const editable = preview && Boolean(onSelect);
  const isSelected = selected === path.join(".");
  const style = {
    textAlign: settings.alignment && settings.alignment !== "inherit" ? settings.alignment : undefined,
    fontSize: settings.fontSize ? `${settings.fontSize}px` : undefined, fontWeight: settings.fontWeight,
    color: settings.color || undefined, backgroundColor: block.type === "button" ? undefined : settings.background || undefined,
    padding: settings.padding === undefined ? undefined : `${settings.padding}px`, borderRadius: settings.radius === undefined ? undefined : `${settings.radius}px`,
    width: settings.width === "full" ? "100%" : undefined,
    "--pws-block-columns": settings.columns ?? 1, "--pws-element-gap": `${settings.gap ?? 20}px`,
    "--pws-block-mobile-columns": settings.mobileColumns ?? (path.length === 1 ? section.style?.mobileColumns ?? 1 : 1),
    "--pws-align-items": settings.alignment && settings.alignment !== "inherit" ? { left: "start", center: "center", right: "end" }[settings.alignment] : undefined,
    "--pws-block-height": `${settings.height ?? 32}px`, "--pws-image-fit": settings.imageFit ?? "cover",
  } as CSSProperties;
  const textStyle: CSSProperties = { fontSize: settings.fontSize ? "inherit" : undefined, fontWeight: settings.fontWeight ? "inherit" : undefined, color: settings.color ? "inherit" : undefined };
  const children = <PortalWebsiteElements {...props} preview={preview} blocks={block.children ?? []} section={section} parentPath={path} />;
  function action(label: ReactNode, className: string) {
    const href = safeWebsiteLink(block.link, props.basePath);
    const actionStyle: CSSProperties = { ...textStyle, color: settings.color || undefined, backgroundColor: settings.background || undefined, borderRadius: settings.radius === undefined ? undefined : settings.radius, width: settings.width === "full" ? "100%" : undefined };
    if (!href) return preview ? <span className={className} style={actionStyle}>{label}</span> : null;
    if (editable) return <button type="button" className={className} style={actionStyle} onClick={() => onSelect?.(path)}>{label}</button>;
    if (preview && /^(home|account|pages\/)/.test(block.link)) return <button type="button" className={className} style={actionStyle} onClick={() => onNavigate?.(block.link)}>{label}</button>;
    return <a href={href} className={className} style={actionStyle} target={block.newTab ? "_blank" : undefined} rel={block.newTab ? "noopener noreferrer" : undefined}>{label}</a>;
  }
  let content: ReactNode;
  if (block.type === "heading") {
    const Heading = block.headingLevel ?? (section.type === "hero" && block.binding === "title" ? "h1" : path.length > 1 && !(section.type === "slideshow" && path.length === 2) ? "h3" : "h2");
    content = block.text || preview ? <Heading style={textStyle}>{block.text || "Add a heading"}</Heading> : null;
  } else if (block.type === "text") content = block.text || preview ? <p className={block.binding === "eyebrow" ? "pws-eyebrow" : "pws-body"} style={textStyle}>{inlineText(block.text || (editable ? "Add text" : ""), editable ? () => onSelect?.(path) : undefined, props.basePath)}</p> : null;
  else if (block.type === "button") content = block.text || preview ? action(<>{block.text || "Add button text"}<ArrowRight /></>, `pws-button pws-button-${settings.buttonStyle ?? "solid"}`) : null;
  else if (block.type === "image") content = block.imageUrl ? <div className="pws-image-media" data-aspect={settings.imageAspect ?? "landscape"}>{settings.imageAspect === "natural" ? <Image src={block.imageUrl} alt={block.alt} width={1200} height={800} style={{ width: "100%", height: "auto" }} unoptimized referrerPolicy="no-referrer" /> : <Image src={block.imageUrl} alt={block.alt} fill unoptimized referrerPolicy="no-referrer" sizes="(max-width:650px) 100vw, 50vw" />}</div> : preview ? <div className="pws-element-empty" data-aspect={settings.imageAspect ?? "landscape"}><ImageIcon /><span>Choose an image</span></div> : null;
  else if (block.type === "group" || block.type === "card" || block.type === "slide") content = <>
    {block.type === "slide" && block.imageUrl && <div className="pws-slide-image"><Image src={block.imageUrl} alt={block.alt} fill unoptimized referrerPolicy="no-referrer" sizes="100vw" /></div>}
    <div className="pws-element-children">{block.children?.length ? children : preview ? <p className="pws-block-placeholder">Add elements to this {block.type}.</p> : null}</div>
  </>;
  else if (block.type === "faq") content = <details className="pws-faq-item" open={preview && selected?.startsWith(`${path.join(".")}.`) ? true : undefined}><summary style={textStyle}>{block.title || "Question"}<span aria-hidden="true">+</span></summary><div><p className="pws-body" style={textStyle}>{inlineText(block.text, editable ? () => onSelect?.(path) : undefined, props.basePath)}</p>{block.children?.length ? <div className="pws-element-children">{children}</div> : null}</div></details>;
  else if (block.type === "testimonial") content = <figure className="pws-quote">{Boolean(block.rating) && <div className="pws-quote-rating" aria-label={`${block.rating} out of 5 stars`}>{Array.from({ length: block.rating ?? 0 }, (_, index) => <Star key={index} />)}</div>}<blockquote style={textStyle}>{block.text || (preview ? "Add a customer quote" : "")}</blockquote><figcaption>{block.imageUrl && <Image src={block.imageUrl} alt={block.alt} width={40} height={40} unoptimized referrerPolicy="no-referrer" />}<strong>{block.title}</strong></figcaption></figure>;
  else if (block.type === "stat") content = <div className="pws-stat"><strong style={textStyle}>{block.text || "—"}</strong><span>{block.title}</span></div>;
  else if (block.type === "icon") { const Icon = icons[block.icon ?? "check"]; content = <div className="pws-icon-label"><Icon style={{ color: settings.color || undefined }} /><span style={textStyle}>{block.text || block.title}</span></div>; }
  else if (block.type === "video") content = block.link.startsWith("https://") && safeWebsiteLink(block.link) ? <video className="pws-video" controls playsInline preload="metadata" src={block.link} poster={block.imageUrl || undefined} aria-label={block.alt || block.title}>Your browser does not support this video.</video> : preview ? <div className="pws-element-empty"><span>Add a video URL</span></div> : null;
  else if (block.type === "divider") content = <hr className="pws-divider" />;
  else content = <div className="pws-spacer-block" />;
  if (!content) return null;
  return <div className={`pws-element pws-element-${block.type}`} data-element-id={block.id} data-selected={isSelected || undefined} data-desktop={settings.desktopVisible ?? true} data-mobile={settings.mobileVisible ?? true} data-width={settings.width} data-alignment={settings.alignment} data-custom-color={Boolean(settings.color)} style={style}
    onPointerDown={editable ? event => { event.stopPropagation(); onSelect?.(path); } : undefined}>
    {editable && <button type="button" className="pws-element-edit" aria-label={`Edit ${block.title || block.type} element`} onClick={() => onSelect?.(path)}>{block.title || block.type}</button>}
    {content}
  </div>;
}

export function PortalWebsiteSlideshow(props: ElementsProps) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const website = root.current?.closest(".portal-website");
    if (!website) return;
    const measure = () => { const width = website.getBoundingClientRect().width; if (width > 0) setMobile(width <= 650); };
    measure();
    if (!window.ResizeObserver) return;
    const observer = new window.ResizeObserver(measure);
    observer.observe(website);
    return () => observer.disconnect();
  }, []);
  const visible = props.blocks.map((block, index) => ({ block, index })).filter(item => item.block.enabled && (mobile ? item.block.style?.mobileVisible : item.block.style?.desktopVisible) !== false);
  const selectedIndex = props.preview && props.selected ? Number(props.selected.split(".")[0]) : -1;
  const selectedSlide = visible.findIndex(item => item.index === selectedIndex);
  const current = selectedSlide >= 0 ? selectedSlide : active % Math.max(1, visible.length);
  useEffect(() => {
    if (hovered || focused || selectedSlide >= 0 || !props.section.style?.autoPlay || visible.length < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive(index => index + 1), (props.section.style.slideInterval ?? 5) * 1000);
    return () => window.clearInterval(timer);
  }, [hovered, focused, selectedSlide, props.section.style?.autoPlay, props.section.style?.slideInterval, visible.length]);
  function change(next: number) {
    const index = (next + visible.length) % visible.length;
    setActive(index); if (visible[index]) props.onSelect?.([visible[index].index]);
  }
  return <div ref={root} className="pws-slideshow-content" aria-roledescription="carousel" aria-label={props.section.title || "Slideshow"} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {visible.map((item, index) => <div key={item.block.id} hidden={index !== current} aria-roledescription="slide" aria-label={`${index + 1} of ${visible.length}`}><WebsiteElement {...props} block={item.block} path={[item.index]} /></div>)}
    {visible.length > 1 && <div className="pws-slideshow-controls"><button type="button" aria-label="Previous slide" onClick={() => change(current - 1)}><ArrowLeft /></button>{visible.map((item, index) => <button key={item.block.id} type="button" aria-label={`Go to slide ${index + 1}`} aria-pressed={index === current} onClick={() => change(index)}><span /></button>)}<button type="button" aria-label="Next slide" onClick={() => change(current + 1)}><ArrowRight /></button></div>}
  </div>;
}
