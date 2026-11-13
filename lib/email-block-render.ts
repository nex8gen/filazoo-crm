import type { EmailBlock } from "./email-design.ts";
import { blockPresentation, borderCss, cssInsets, productButtonStyle, productConfig, productTextStyle, shadowCss } from "./email-block-config.ts";

export type EmailBlockRenderHelpers = { escape: (value: string) => string; link: (value: string) => string; imageUrl: (value: string) => string; mobile: boolean };
export function emailAreaCss(block: EmailBlock) { const p = blockPresentation(block); return `padding:${cssInsets(p.areaPadding)};background:${p.areaBackground};${block.type === "button" ? "" : `border:${borderCss(p.border)};border-radius:${block.radius}px;`}overflow-wrap:anywhere;`; }
export function wrapEmailArea(block: EmailBlock, content: string) { return `<div style="${emailAreaCss(block)}">${content}</div>`; }
export function renderBlockImage(block: EmailBlock, helpers: EmailBlockRenderHelpers, src = block.src, alt = block.alt, mobileLogo = false) {
  const p = blockPresentation(block), safe = helpers.imageUrl(src);
  if (!safe) return "";
  const fill = helpers.mobile ? p.image.fillMobile : p.image.fill;
  const width = fill ? "100%" : p.image.autoWidth ? "auto" : `${block.width}px`;
  const height = !p.image.lockAspect && p.image.height ? `${p.image.height}px` : "auto";
  const margin = block.align === "center" ? "0 auto" : block.align === "right" ? "0 0 0 auto" : "0 auto 0 0";
  return `<img class="email-image-${block.id}${mobileLogo ? " email-header-mobile-logo" : ""}" src="${helpers.escape(safe)}" alt="${helpers.escape(alt)}"${!p.image.autoWidth && !fill ? ` width="${block.width}"` : fill ? ' width="100%"' : ""}${!p.image.lockAspect && p.image.height ? ` height="${p.image.height}"` : ""} style="display:block;width:${width};max-width:100%;height:${height};border-radius:${block.radius}px;margin:${margin};">`;
}
export function renderBlockButton(block: EmailBlock, helpers: EmailBlockRenderHelpers) {
  const p = blockPresentation(block), href = helpers.link(block.href);
  return `<a class="email-button-${block.id}"${href ? ` href="${helpers.escape(href)}"` : ""} style="display:inline-block;box-sizing:border-box;${p.button.fullWidth || helpers.mobile && p.fullWidthMobile ? "width:100%;" : ""}padding:${cssInsets(p.button.padding)};background:${block.background};color:${block.color};border:${borderCss(p.border)};border-radius:${block.radius}px;text-decoration:${[block.underline && "underline", p.strike && "line-through"].filter(Boolean).join(" ") || "none"};font-weight:inherit;box-shadow:${shadowCss(block)};text-align:${block.align};">${helpers.escape(block.text).replace(/\n/g, "<br>")}</a>`;
}
export function renderBlockHeader(block: EmailBlock, helpers: EmailBlockRenderHelpers) {
  const p = blockPresentation(block), h = p.header;
  const wrapLink = (href: string, content: string) => helpers.link(href) ? `<a href="${helpers.escape(helpers.link(href))}" style="color:inherit;text-decoration:none;">${content}</a>` : content;
  const desktopLogo = block.src ? renderBlockImage(block, helpers, block.src, block.alt || block.text) : helpers.escape(block.text);
  const mobileLogo = !h.sameMobileLogo && h.mobileSrc ? renderBlockImage(block, helpers, h.mobileSrc, h.mobileAlt || block.alt || block.text, true) : desktopLogo;
  const logo = helpers.mobile ? mobileLogo : !h.sameMobileLogo && h.mobileSrc ? `<div class="email-header-desktop-logo">${desktopLogo}</div><div class="email-header-mobile-logo" style="display:none;mso-hide:all;">${mobileLogo}</div>` : desktopLogo;
  const links = block.links.map(item => {
    const content = item.customSrc && helpers.imageUrl(item.customSrc) ? `<img src="${helpers.escape(helpers.imageUrl(item.customSrc))}" alt="${helpers.escape(item.label)}" width="${Math.min(block.width, 120)}" style="max-width:100%;height:auto;">` : helpers.escape(item.label);
    return `<td style="padding:${cssInsets(h.linkPadding)};color:${h.linkColor};font-size:${h.linkSize}px;text-align:${block.align};${h.horizontal === "manual" ? `padding-right:${h.linkGap}px;` : ""}">${wrapLink(item.href, content)}</td>`;
  }).join("");
  const nav = `<table role="presentation" class="email-header-links" cellspacing="0" cellpadding="0" align="${block.align}" style="${h.horizontal === "auto" ? "width:100%;" : ""}"><tr>${links}</tr></table>`;
  const stacked = helpers.mobile ? h.mobileLayout === "stack" : h.layout === "stacked";
  const hideLogo = helpers.mobile && h.mobileLayout === "links-only", hideLinks = helpers.mobile && h.mobileLayout === "logo-only";
  const logoCell = `<td class="email-header-logo" valign="${h.verticalAlign}" style="${stacked ? "display:block;width:100%;" : ""}padding:${stacked ? `0 0 ${h.gap}px` : `0 ${h.gap}px 0 0`};">${wrapLink(h.logoHref, logo)}</td>`;
  const linkCell = `<td class="email-header-nav" valign="${h.verticalAlign}" style="${stacked ? "display:block;width:100%;" : ""}">${nav}</td>`;
  return `<table role="presentation" class="email-header email-header-${block.id}" width="100%" cellspacing="0" cellpadding="0"><tr>${h.layout === "reverse" && !(helpers.mobile && stacked) ? `${!hideLinks ? linkCell : ""}${!hideLogo ? logoCell : ""}` : `${!hideLogo ? logoCell : ""}${!hideLinks ? linkCell : ""}`}</tr></table>`;
}
export function renderProductGrid(block: EmailBlock, helpers: EmailBlockRenderHelpers) {
  const config = productConfig(block);
  const start = config.mode === "static" ? config.start : 0;
  const cards = config.cards.slice(start, start + config.perRow * config.rows);
  const columns = helpers.mobile && config.stackMobile ? 1 : config.perRow;
  const style = (which: "name" | "price") => { const s = productTextStyle(block, which); return `font-family:'${s.fontFamily}',Arial,sans-serif;font-size:${s.fontSize}px;color:${s.color};font-weight:${s.bold ? 700 : 400};font-style:${s.italic ? "italic" : "normal"};text-decoration:${[s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") || "none"};letter-spacing:${s.letterSpacing}px;padding:${s.paddingTop}px 0 ${s.paddingBottom}px;`; };
  function card(index: number) {
    const item = cards[index];
    const href = helpers.link(item.href), src = helpers.imageUrl(item.imageUrl);
    const image = src ? `<img src="${helpers.escape(src)}" alt="${helpers.escape(item.name)}" height="${config.maxImageHeight}" style="display:block;max-width:100%;max-height:${config.maxImageHeight}px;width:auto;height:auto;margin:0 auto;">` : "";
    const name = config.showName ? `<div style="${style("name")}">${config.linkName && href ? `<a href="${helpers.escape(href)}" style="color:inherit;text-decoration:inherit;">${helpers.escape(item.name)}</a>` : helpers.escape(item.name)}</div>` : "";
    const price = config.showPrice ? `<div style="${style("price")}">${config.showOriginalPrice && item.originalPrice ? `<s>${helpers.escape(item.originalPrice)}</s> ` : ""}${helpers.escape(item.price)}</div>` : "";
    const button = productButtonStyle(block);
    const action = config.showButton ? `<div style="text-align:${button.align};margin-top:10px;"><a${href ? ` href="${helpers.escape(href)}"` : ""} style="display:inline-block;padding:${cssInsets(button.padding)};font-family:'${button.fontFamily}',Arial,sans-serif;font-size:${button.fontSize}px;color:${button.color};background:${button.background};border:${borderCss(button.border)};border-radius:${button.radius}px;font-weight:${button.bold ? 700 : 400};font-style:${button.italic ? "italic" : "normal"};text-decoration:${[button.underline && "underline", button.strike && "line-through"].filter(Boolean).join(" ") || "none"};letter-spacing:${button.letterSpacing}px;${button.shadow ? `box-shadow:0 3px 8px ${button.shadowColor}40;` : ""}">${helpers.escape(config.buttonText)}</a></div>` : "";
    const details = `${name}${price}${config.showDescription ? `<p>${helpers.escape(item.description)}</p>` : ""}${config.showRating && item.rating !== null ? `<p aria-label="Rating ${item.rating} out of 5">${"★".repeat(Math.round(item.rating))} (${item.rating}/5)</p>` : ""}${action}`;
    const inside = config.layout === "grid" ? image + details : `<table role="presentation" width="100%"><tr>${config.layout === "image-right" ? `<td>${details}</td><td>${image}</td>` : `<td>${image}</td><td>${details}</td>`}</tr></table>`;
    return `<td class="email-product-card" width="${100 / columns}%" valign="top" style="padding:${cssInsets(config.cardPadding ?? { top: 10, right: 10, bottom: 10, left: 10 })};border:${borderCss(config.border ?? { style: "none", width: 0, color: "#000000" })};text-align:${block.align};">${inside}</td>`;
  }
  return `<table role="presentation" class="email-products-${block.id}" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;border-collapse:collapse;">${Array.from({ length: Math.ceil(cards.length / columns) }, (_, row) => `<tr>${cards.slice(row * columns, row * columns + columns).map((_, col) => card(row * columns + col)).join("")}</tr>`).join("")}</table>`;
}
