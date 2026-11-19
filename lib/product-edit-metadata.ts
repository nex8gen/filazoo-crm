import { productMediaTag } from "./product-images.ts";

/** Replace only the metadata explicitly supplied by the editor. */
export function productEditMetadata(existing: { tags?: string[] | null; description?: string | null }, tags: string[], generatedDescription: string, manualInventory?: number | null, content?: { description?: string; mediaUrls?: string[] }) {
  return {
    tags: [...new Set([...(existing.tags ?? []).filter((tag) => !tag.startsWith("price-tier:") && !tag.startsWith("variant-json:") && (manualInventory === undefined || !tag.startsWith("manual-inventory:")) && (content?.mediaUrls === undefined || !tag.startsWith("media-json:"))), "manual", ...tags, ...(manualInventory == null ? [] : [`manual-inventory:${manualInventory}`]), ...(content?.mediaUrls === undefined ? [] : [productMediaTag(content.mediaUrls)])])],
    description: content?.description !== undefined ? content.description : existing.description === null || existing.description === undefined || existing.description.startsWith("Volume pricing:") ? generatedDescription : existing.description,
  };
}
