import { z } from "zod";

export const marketingCategories = ["month_end", "holiday", "factory_sale"] as const;
export type MarketingCategory = typeof marketingCategories[number];
export const marketingCategoryLabels: Record<MarketingCategory, string> = {
  month_end: "Month-end promotions", holiday: "Holiday promotions", factory_sale: "Factory sales",
};
export const marketingYearSchema = z.coerce.number().int().min(2020).max(2100);
export const marketingAssetInputSchema = z.object({
  id: z.uuid(),
  category: z.enum(marketingCategories),
  slot: z.string().trim().min(1).max(80),
  year: marketingYearSchema,
  title: z.string().trim().min(1, "Give this promotion a name.").max(160),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  productSkus: z.array(z.string().trim().min(1).max(160)).max(100).transform(values => [...new Set(values)]),
  audience: z.string().trim().max(2000),
  offer: z.string().trim().max(8000),
  message: z.string().trim().max(12000),
  status: z.enum(["draft", "ready"]),
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
}).superRefine((asset, ctx) => {
  if (asset.endDate < asset.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the start date." });
  if (Number(asset.startDate.slice(0, 4)) !== asset.year) ctx.addIssue({ code: "custom", path: ["startDate"], message: "Start date must be in the selected year." });
  if (asset.category === "month_end" && !/^month-(?:[1-9]|1[0-2])$/.test(asset.slot)) ctx.addIssue({ code: "custom", path: ["slot"], message: "Choose a valid month." });
  if (asset.status === "ready" && (!asset.offer || !asset.message)) ctx.addIssue({ code: "custom", path: ["status"], message: "Add an offer and a message before marking this plan ready." });
});
export type MarketingAsset = z.infer<typeof marketingAssetInputSchema>;
export type MarketingProduct = { sku: string; name: string; material: string };
export type MarketingSlot = { key: string; title: string; startDate: string; endDate: string; month: number };

export const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateString = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function monthEndSlots(year: number): MarketingSlot[] {
  return monthNames.map((name, index) => {
    const last = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    return { key: `month-${index + 1}`, title: `${name} promotion`, startDate: dateString(year, index + 1, last - 6), endDate: dateString(year, index + 1, last), month: index + 1 };
  });
}

// U.S. retail occasions use actual dates, rather than federal observed dates.
export function holidaySlots(year: number): MarketingSlot[] {
  const weekday = (month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const thanksgiving = 1 + (4 - weekday(11, 1) + 7) % 7 + 21;
  const laborDay = 1 + (1 - weekday(9, 1) + 7) % 7;
  const memorialDay = 31 - (weekday(5, 31) - 1 + 7) % 7;
  const blackFriday = new Date(Date.UTC(year, 10, thanksgiving + 1));
  const cyberMonday = new Date(Date.UTC(year, 10, thanksgiving + 4));
  return [
    ["new-year", "New Year's Day", 1, 1], ["valentines", "Valentine's Day", 2, 14],
    ["memorial-day", "Memorial Day", 5, memorialDay], ["independence-day", "Independence Day", 7, 4],
    ["labor-day", "Labor Day", 9, laborDay], ["halloween", "Halloween", 10, 31],
    ["thanksgiving", "Thanksgiving", 11, thanksgiving],
    ["black-friday", "Black Friday", blackFriday.getUTCMonth() + 1, blackFriday.getUTCDate()],
    ["cyber-monday", "Cyber Monday", cyberMonday.getUTCMonth() + 1, cyberMonday.getUTCDate()],
    ["christmas", "Christmas", 12, 25],
  ].map(([key, title, month, day]) => ({ key: String(key), title: String(title), startDate: dateString(year, Number(month), Number(day)), endDate: dateString(year, Number(month), Number(day)), month: Number(month) }));
}

export function newMarketingAsset(category: MarketingCategory, year: number, slot?: MarketingSlot): MarketingAsset {
  const id = crypto.randomUUID();
  return { id, category, year, slot: slot?.key ?? id, title: slot?.title ?? "New factory sale", startDate: slot?.startDate ?? dateString(year, 1, 1), endDate: slot?.endDate ?? dateString(year, 1, 7), productSkus: [], audience: "", offer: "", message: "", status: "draft", updatedAt: null };
}

export function marketingDateRange(start: string, end: string) {
  const format = (value: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}

export function marketingAssetText(asset: MarketingAsset, products: MarketingProduct[]) {
  return [asset.title, `Dates: ${asset.startDate} – ${asset.endDate}`, `Audience: ${asset.audience || "Not specified"}`, `Products: ${asset.productSkus.map(sku => products.find(product => product.sku === sku)?.name ?? sku).join(", ") || "Not selected"}`, "", "OFFER", asset.offer, "", "MESSAGE", asset.message].join("\n");
}
