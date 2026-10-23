import { PROFILE_AVATAR_MAX_BYTES } from "./profile-avatar.ts";

async function decodePhoto(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; dispose: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // Some browsers can display a photo but cannot decode it as a bitmap.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This image could not be read. Choose another photo."));
      image.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function resizeProfilePhoto(file: File): Promise<Blob> {
  const photo = await decodePhoto(file);
  try {
    if (!photo.width || !photo.height) throw new Error("This image could not be read. Choose another photo.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not process this photo.");
    const side = Math.min(photo.width, photo.height);
    context.drawImage(photo.image, (photo.width - side) / 2, (photo.height - side) / 2, side, side, 0, 0, 384, 384);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Your browser could not process this photo.")), "image/webp", 0.85));
    // Browsers may silently return PNG when their canvas cannot encode WebP.
    if (blob.type !== "image/webp") throw new Error("Your browser cannot save WebP photos. Try uploading with another browser.");
    if (blob.size > PROFILE_AVATAR_MAX_BYTES) throw new Error("This photo is too large after resizing. Choose another photo.");
    return blob;
  } finally {
    photo.dispose();
  }
}
