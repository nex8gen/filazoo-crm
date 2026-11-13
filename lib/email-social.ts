import { emailSocialAssets } from "./email-social-assets.ts";
import type { EmailBlock } from "./email-design.ts";
import { blockInsets, blockPresentation, cssInsets } from "./email-block-config.ts";

export const emailSocialPlatforms = ["custom", "facebook", "youtube", "instagram", "twitter", "x", "tiktok", "snapchat", "pinterest", "linkedin", "android", "apple", "email", "rss"] as const;
export type EmailSocialPlatform = typeof emailSocialPlatforms[number];
export type EmailSocialLink = EmailBlock["links"][number];
export const emailSocialDefaults = {
  showLabels: true, iconSize: "medium" as "small" | "medium" | "large", iconColor: "brand" as "brand" | "black" | "white",
  gap: 10, stackMobile: false, paddingX: null as number | null, paddingY: null as number | null, showDesktop: true, showMobile: true,
};
export function emailSocialSettings(block: EmailBlock) { return { ...emailSocialDefaults, ...block.social }; }
export function emailSocialPlatform(link: EmailSocialLink): EmailSocialPlatform {
  if (link.platform) return link.platform;
  return emailSocialAssets.find(item => item.label.toLowerCase() === link.label.trim().toLowerCase())?.id ?? "custom";
}
export function emailSocialAsset(platform: EmailSocialPlatform, style: "brand" | "black" | "white" = "brand") {
  return emailSocialAssets.find(item => item.id === platform)!.images[style];
}
export function newEmailSocialLink(platform: EmailSocialPlatform = "facebook", spacer = false): EmailSocialLink {
  return { id: crypto.randomUUID(), kind: spacer ? "spacer" : "icon", platform, label: spacer ? "Spacer" : emailSocialAssets.find(item => item.id === platform)!.label, href: "", spacerWidth: 16, customSrc: "" };
}
export function moveEmailSocialLink(links: EmailSocialLink[], from: number, to: number) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= links.length || to >= links.length || from === to) return links;
  const result = [...links]; const [item] = result.splice(from, 1); result.splice(to, 0, item); return result;
}
export function emailBlockPadding(block: EmailBlock) {
  const padding = blockInsets(block);
  if (padding.top === padding.bottom && padding.left === padding.right) return padding.top === padding.left ? `${padding.top}px` : `${padding.top}px ${padding.left}px`;
  return cssInsets(padding);
}

/** Raster icons remain usable in mail clients; the mailer embeds data URLs as CID attachments. */
export function renderEmailSocial(block: EmailBlock, helpers: { escape: (value: string) => string; link: (value: string) => string; imageUrl: (value: string) => string; mobile?: boolean }) {
  const settings = emailSocialSettings(block);
  const p = blockPresentation(block);
  const size = { small: 16, medium: 24, large: 32 }[settings.iconSize];
  const stack = helpers.mobile && settings.stackMobile;
  const cells = block.links.map((item, index) => {
    const cellClass = settings.stackMobile ? " class=\"email-social-stack\"" : "";
    if (item.kind === "spacer") {
      const width = item.spacerWidth ?? 16;
      return `<td class="${settings.stackMobile ? "email-social-stack " : ""}email-social-spacer-${index}" data-social-spacer="true" width="${width}" height="${stack ? width : 1}" style="width:${width}px;${stack ? `height:${width}px;` : ""}font-size:0;line-height:0;">&nbsp;</td>`;
    }
    const platform = emailSocialPlatform(item);
    const label = item.label || emailSocialAssets.find(asset => asset.id === platform)!.label;
    const src = platform === "custom" && item.customSrc ? helpers.imageUrl(item.customSrc) : emailSocialAsset(platform, settings.iconColor);
    const icon = src ? `<img src="${helpers.escape(src)}" width="${size}" height="${size}" alt="${settings.showLabels ? "" : helpers.escape(label)}" style="display:inline-block;width:${size}px;height:${size}px;border:0;vertical-align:middle;">` : "";
    const text = settings.showLabels ? `<span style="vertical-align:middle;${icon ? "margin-left:6px;" : ""}">${helpers.escape(label)}</span>` : "";
    // A custom icon without an image must still have visible, accessible content.
    const content = icon + text || helpers.escape(label);
    const href = helpers.link(item.href);
    const anchor = href ? `<a href="${helpers.escape(href)}" aria-label="${helpers.escape(label)}" style="display:inline-block;color:inherit;text-decoration:${[block.underline && "underline", p.strike && "line-through"].filter(Boolean).join(" ") || "none"};">${content}</a>` : `<span>${content}</span>`;
    return `<td${cellClass} data-social-platform="${platform}" style="vertical-align:middle;${stack ? `padding:${settings.gap / 2}px 0;text-align:${block.align};` : `padding:0 ${settings.gap / 2}px;`}font-family:inherit;font-size:${block.fontSize}px;color:inherit;white-space:nowrap;">${anchor}</td>`;
  });
  return `<table role="presentation" class="email-social email-social-${block.id}" align="${block.align}" cellspacing="0" cellpadding="0" style="border-collapse:collapse;${stack ? "width:100%;" : "display:inline-table;"}text-align:${block.align};"><tbody>${stack ? cells.map(cell => `<tr>${cell}</tr>`).join("") : `<tr>${cells.join("")}</tr>`}</tbody></table>`;
}
