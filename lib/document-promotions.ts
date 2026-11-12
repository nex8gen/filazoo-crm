import type { LibraryDocument } from "./documents.ts";
import { holidaySlots, marketingCategoryLabels, monthEndSlots, type MarketingAsset, type MarketingCategory, type MarketingSlot } from "./marketing-assets.ts";

export type PromotionStatusFilter = "all" | "draft" | "ready" | "unplanned" | "scheduled" | "queued";
export type PromotionTemplateSeed = Pick<LibraryDocument, "name" | "kind" | "category" | "subject" | "body" | "description" | "tags" | "company" | "related_ids">;
export type PromotionLibraryRow = { key: string; slot?: MarketingSlot; asset?: MarketingAsset; title: string; startDate: string; endDate: string };

export function promotionLibraryRows(assets: MarketingAsset[], category: MarketingCategory, year: number, status: PromotionStatusFilter, query: string): PromotionLibraryRow[] {
  const current = assets.filter(asset => asset.category === category && asset.year === year);
  const slots = category === "month_end" ? monthEndSlots(year) : category === "holiday" ? holidaySlots(year) : [];
  const rows: PromotionLibraryRow[] = slots.map(slot => {
    const asset = current.find(item => item.slot === slot.key);
    return { key: slot.key, slot, asset, title: asset?.title ?? slot.title, startDate: asset?.startDate ?? slot.startDate, endDate: asset?.endDate ?? slot.endDate };
  });
  // Preserve older custom occasions as well as the standard planning calendar.
  for (const asset of current) if (!slots.some(slot => slot.key === asset.slot)) rows.push({ key: asset.id, asset, title: asset.title, startDate: asset.startDate, endDate: asset.endDate });
  const search = query.trim().toLowerCase();
  return rows.filter(row => {
    const rowStatus = row.asset?.dispatch ? row.asset.campaignConfig?.sendMode === "scheduled" ? "scheduled" : "queued" : row.asset?.status ?? "unplanned";
    return (status === "all" || rowStatus === status) && `${row.title} ${row.asset?.offer ?? ""} ${row.asset?.audience ?? ""} ${row.asset?.message ?? ""} ${row.asset?.campaignConfig?.subject ?? ""} ${row.asset?.campaignConfig?.tags.join(" ") ?? ""}`.toLowerCase().includes(search);
  });
}

/** Transfer customer-facing copy; keep planning notes out of the email body. */
export function promotionEmailTemplate(asset: MarketingAsset): PromotionTemplateSeed {
  const message = asset.message.trim();
  if (!message) throw new Error("Write a message before creating an email template.");
  const match = /^(?:Subject\s*:|主题\s*[:：])\s*([^\r\n]+)\r?\n+([\s\S]+)$/i.exec(message);
  const subject = match ? match[1].trim() : asset.title;
  const body = match ? match[2].replace(/^Body\s*:\s*\r?\n/i, "").trim() : message;
  return {
    name: asset.title, kind: "template", category: "promotion", subject: subject.slice(0, 300), body,
    company: "", tags: [marketingCategoryLabels[asset.category], String(asset.year)], related_ids: [],
    description: [`Promotion: ${marketingCategoryLabels[asset.category]}`, `Dates: ${asset.startDate} – ${asset.endDate}`, asset.audience ? `Audience: ${asset.audience}` : "", asset.offer ? `Offer: ${asset.offer}` : ""].filter(Boolean).join("\n").slice(0, 2000),
  };
}
