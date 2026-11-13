"use client";

export const emailImageSourceLimit = 10 * 1024 * 1024;
export const emailInlineImageLimit = 750_000;
/** Keep small images and animation bytes intact; optimize large static sources for email. */
export async function optimizeEmailImage(file: File): Promise<File> {
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPG, GIF, or WebP image.");
  if (file.size > emailImageSourceLimit) throw new Error("Choose an image up to 10 MB.");
  if (file.size <= emailInlineImageLimit) return file;
  if (file.type === "image/gif") throw new Error("Animated GIFs must be up to 750 KB so their animation can be preserved in email.");
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Unable to read this image.")); image.src = src; });
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Choose an image with fewer than 40 megapixels.");
    let scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d"); if (!context) throw new Error("Your browser cannot optimize images.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, file.type === "image/jpeg" ? "image/jpeg" : "image/png", .85));
      if (blob && blob.size <= emailInlineImageLimit) return new File([blob], file.name.replace(/\.[^.]+$/, "") + (blob.type === "image/jpeg" ? ".jpg" : ".png"), { type: blob.type });
      scale *= .75;
    }
    throw new Error("This image could not be reduced to the email size limit. Choose a smaller image.");
  } finally { URL.revokeObjectURL(src); }
}
