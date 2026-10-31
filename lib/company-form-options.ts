export type CountryOption = { code: string; name: string };

export const companySegmentOptions = [
  "3D printing service bureau", "3D printing farm", "3D printer reseller",
  "Filament distributor", "Filament wholesaler", "3D printing retailer",
  "Design / prototyping studio", "Manufacturer", "Education / research",
  "Distributor", "Wholesaler", "Importer", "Online retailer", "Brand / private label", "Other",
];

export const contactRoleOptions = [
  "Owner / Founder", "CEO / Managing Director", "Purchasing Manager", "Buyer",
  "Procurement Manager", "Category Manager", "Product Manager", "Store Manager",
  "Sales Manager", "Business Development Manager", "Operations Manager",
  "Marketing Manager", "Other",
];

export function normalizeOption(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
