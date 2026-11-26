import { MAX_CHAT_IMAGES, MAX_CHAT_FILE_BYTES, MAX_IMAGE_BYTES, CHAT_IMAGE_ACCEPT, imageByteLength, type ChatImage, type ChatFile } from "./image-input.ts";
import { attachmentMimeType } from "../email-files.ts";

async function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read this file. Try adding it again."));
    reader.onabort = () => reject(new Error("Reading this file was interrupted. Try adding it again."));
    reader.readAsDataURL(blob);
  });
}

export async function prepareChatImages(files: File[]): Promise<ChatImage[]> {
  if (files.length > MAX_CHAT_IMAGES) throw new Error(`Add up to ${MAX_CHAT_IMAGES} images at a time.`);
  // Sequential decoding bounds memory when several large images are selected.
  const images: ChatImage[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) throw new Error("Choose an image.");
    if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("Choose images smaller than 10 MB.");
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error("This image could not be opened. Choose another JPG, PNG or WebP image."); }
    try {
      if (bitmap.width * bitmap.height > 40_000_000) throw new Error("This image is too large. Crop or resize it first.");
      let dataUrl = await readDataUrl(file);
      if (!CHAT_IMAGE_ACCEPT.split(",").includes(file.type) || imageByteLength(dataUrl) > MAX_IMAGE_BYTES || Math.max(bitmap.width, bitmap.height) > 2_000) {
        const scale = Math.min(1, 2_000 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image processing is unavailable. Try a smaller image.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        if (imageByteLength(dataUrl) > MAX_IMAGE_BYTES) dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      }
      if (imageByteLength(dataUrl) > MAX_IMAGE_BYTES) throw new Error("This image is too detailed to attach. Crop it into a smaller image.");
      images.push({ name: (file.name || "Pasted image").slice(0, 160), dataUrl });
    } finally { bitmap.close(); }
  }
  return images;
}

/** All types can attach; browser-readable images are normalized for vision. */
export async function prepareChatAttachments(selected: File[]): Promise<{ images: ChatImage[]; files: ChatFile[] }> {
  if (selected.length > MAX_CHAT_IMAGES) throw new Error(`Add up to ${MAX_CHAT_IMAGES} files at a time, including images.`);
  const images: ChatImage[] = [];
  const files: ChatFile[] = [];
  for (const file of selected) {
    const mediaType = attachmentMimeType(file.name, file.type);
    if (mediaType.startsWith("image/") && file.size <= 10 * 1024 * 1024) {
      try {
        images.push(...await prepareChatImages([file.type === mediaType ? file : new File([file], file.name, { type: mediaType })]));
        continue;
      } catch { /* Preserve formats the browser cannot decode as file attachments. */ }
    }
    if (file.size > MAX_CHAT_FILE_BYTES) throw new Error(`“${file.name}” is too large. Attach up to 3 MB total.`);
    files.push({ name: (file.name || "Attachment").slice(0, 160), mediaType, dataUrl: await readDataUrl(new Blob([file], { type: mediaType })) });
  }
  return { images, files };
}
