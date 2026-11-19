import { isProductVideo, productLibraryMediaPattern } from "./product-media.ts";

export const PRODUCT_IMAGE_BUCKET = "user-product-images";
export const privateProductImagePattern = /^\/api\/product-images\/([\da-f-]{36})\/([\da-f-]{36}\.(?:jpg|png|webp|gif))$/i;

export function validProductImage(value: string) {
  if (!value) return true;
  if (isProductVideo(value)) return false;
  if (productLibraryMediaPattern.test(value)) return true;
  if (privateProductImagePattern.test(value)) return true;
  if (/^\/(?:quotation-2610\/|catalog-default-product\.)/.test(value) && !value.includes("..") && !/[?#\\]/.test(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
export function validProductMedia(value: string) {
  if (productLibraryMediaPattern.test(value)) return true;
  if (!isProductVideo(value)) return validProductImage(value);
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
export const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_PRODUCT_MEDIA = 20;

export function productMediaTag(urls: string[]) {
  return `media-json:${encodeURIComponent(JSON.stringify(urls))}`;
}

export function productMediaFromTags(tags: string[], fallback: (string | null)[]) {
  const encoded = tags.find((tag) => tag.startsWith("media-json:"));
  if (encoded) {
    try {
      const values: unknown = JSON.parse(decodeURIComponent(encoded.slice("media-json:".length)));
      if (Array.isArray(values) && values.every((value) => typeof value === "string" && value && validProductMedia(value))) return [...new Set(values as string[])].slice(0, MAX_PRODUCT_MEDIA);
    } catch { /* Legacy media falls back to the existing product photos. */ }
  }
  return [...new Set(fallback.filter((value): value is string => Boolean(value)))].slice(0, MAX_PRODUCT_MEDIA);
}

export function productImageError(type: string, size: number): string | null {
  if (!PRODUCT_IMAGE_TYPES.includes(type)) return "Choose a JPG, PNG, WebP, or GIF image.";
  if (!Number.isInteger(size) || size <= 0 || size > MAX_PRODUCT_IMAGE_SIZE) return "Choose an image smaller than 5 MB.";
  return null;
}
