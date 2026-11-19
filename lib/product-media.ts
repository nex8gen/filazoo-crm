export const PRODUCT_LIBRARY_MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
};
export const MAX_LIBRARY_MEDIA_BYTES = 50 * 1024 * 1024;
export const productLibraryMediaPattern = /^\/api\/product-media\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\/media\.(jpg|png|webp|gif|avif|svg|bmp|mp4|webm|mov|ogv)$/i;
export type ProductLibraryMedia = { id: string; name: string; mimeType: string; size: number; createdAt: string; url: string };
export type ProductMediaPage = { items: ProductLibraryMedia[]; total: number; canUpload?: boolean };

export function productLibraryMediaUrl(id: string, mimeType: string) {
  const extension = Object.hasOwn(PRODUCT_LIBRARY_MEDIA_TYPES, mimeType) ? PRODUCT_LIBRARY_MEDIA_TYPES[mimeType] : null;
  return extension ? `/api/product-media/${id}/media.${extension}` : null;
}
export function isProductVideo(url: string) {
  return /^data:video\//i.test(url) || /\.(?:mp4|webm|mov|ogv|ogg)(?:[?#]|$)/i.test(url);
}
export function productMediaCover(urls: string[]) { return urls.find(url => !isProductVideo(url)) ?? null; }
export function libraryMediaUploadError(type: string, size: number) {
  if (!Object.hasOwn(PRODUCT_LIBRARY_MEDIA_TYPES, type)) return "Choose an image or an MP4, WebM, MOV, or Ogg video.";
  if (!Number.isInteger(size) || size <= 0 || size > MAX_LIBRARY_MEDIA_BYTES) return "Choose a file up to 50 MB.";
  return null;
}
export function mediaSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
