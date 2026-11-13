import type { Product } from "./types.ts";
import type { EmailBlock, EmailDesign } from "./email-design.ts";
import { productConfig, type EmailProductCard } from "./email-block-config.ts";
import { privateProductImagePattern } from "./product-images.ts";
import { emailDesignUrl } from "./email-design.ts";

export function emailProductSnapshot(product: Product): EmailProductCard {
  return { sku: product.sku, name: product.name, imageUrl: product.imageUrl ?? "", description: product.material, price: product.price, originalPrice: "", rating: null, href: "" };
}
export function selectEmailFeedProducts(block: EmailBlock, products: Product[]) {
  const config = productConfig(block), feed = config.feed;
  const query = feed?.search.trim().toLowerCase() ?? "";
  const rows = products.filter(product => product.status !== "Inactive" && (!feed?.material || product.material === feed.material) && (!query || `${product.name} ${product.sku}`.toLowerCase().includes(query)) && (!feed?.availableOnly || (product.stock ? product.stock.available > 0 : /^(in stock|available|ready)/i.test(product.stockStatus))));
  const amount = (value: string) => Number(value.replace(/[^\d.-]/g, "")) || 0;
  rows.sort((a, b) => feed?.sort === "newest" ? (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") : feed?.sort === "price-low" ? amount(a.price) - amount(b.price) : feed?.sort === "price-high" ? amount(b.price) - amount(a.price) : a.name.localeCompare(b.name));
  return rows.slice(config.start, config.start + config.perRow * config.rows).map(product => ({ ...emailProductSnapshot(product), href: feed?.linkTemplate.replaceAll("{sku}", encodeURIComponent(product.sku)) ?? "" }));
}
/** Dynamic selection is evaluated once when a campaign is queued, so every recipient sees the same snapshot. */
export function resolveEmailProductFeeds(design: EmailDesign, products: Product[]): EmailDesign {
  return { ...design, blocks: design.blocks.map(block => block.type === "product" && block.product?.mode === "dynamic" ? { ...block, product: { ...block.product, cards: selectEmailFeedProducts(block, products) } } : block) };
}
export function emailProductIssues(design: EmailDesign) {
  const issues: string[] = [];
  for (const block of design.blocks) {
    if (block.type !== "product" || !block.product) continue;
    const config = productConfig(block), cards = config.cards.slice(config.mode === "static" ? config.start : 0, (config.mode === "static" ? config.start : 0) + config.perRow * config.rows);
    if (!cards.length) issues.push("Choose products or a product feed with matching products before sending.");
    if (config.showButton || config.linkName) for (const card of cards) if (!emailDesignUrl(card.href)) issues.push(`Add a public product link for ${card.name} before sending.`);
  }
  return issues;
}

export async function inlinePrivateEmailImages(design: EmailDesign, load: (src: string) => Promise<string>): Promise<EmailDesign> {
  const cache = new Map<string, Promise<string>>();
  function image(src: string) { if (!privateProductImagePattern.test(src) && !/^\/(?:quotation-2610\/|catalog-default-product\.)/.test(src)) return Promise.resolve(src); if (!cache.has(src)) cache.set(src, load(src)); return cache.get(src)!; }
  return { ...design, blocks: await Promise.all(design.blocks.map(async block => ({
    ...block,
    src: await image(block.src),
    links: await Promise.all(block.links.map(async link => link.customSrc ? { ...link, customSrc: await image(link.customSrc) } : link)),
    ...(block.product ? { product: { ...block.product, cards: await Promise.all(block.product.cards.map(async card => ({ ...card, imageUrl: await image(card.imageUrl) }))) } } : {}),
    ...(block.presentation?.header?.mobileSrc ? { presentation: { ...block.presentation, header: { ...block.presentation.header, mobileSrc: await image(block.presentation.header.mobileSrc) } } } : {}),
  }))) };
}
