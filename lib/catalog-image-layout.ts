/** Quotation imports contain source-table rules around the photo edges. */
export function catalogImageCrop(url: string, width: number, height: number) {
  // Crop only these imported photos, leaving ordinary uploads and the originals intact.
  const imported = url.includes("/quotation-2610/") && width >= 40 && height >= 40;
  const left = imported ? Math.ceil(width * 0.015) : 0;
  const top = imported ? Math.ceil(height * 0.015) : 0;
  return { left, top, width: width - left * 2, height: height - top * 2 };
}
