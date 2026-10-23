export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function productImageError(type: string, size: number): string | null {
  if (!PRODUCT_IMAGE_TYPES.includes(type)) return "Choose a JPG, PNG, WebP, or GIF image.";
  if (!Number.isInteger(size) || size <= 0 || size > MAX_PRODUCT_IMAGE_SIZE) return "Choose an image smaller than 5 MB.";
  return null;
}
