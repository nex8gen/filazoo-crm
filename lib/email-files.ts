// Shared by the composer and authenticated attachment downloads.
const extensionTypes: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", json: "application/json", xml: "application/xml",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  bmp: "image/bmp", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", gz: "application/gzip", "7z": "application/x-7z-compressed", rar: "application/vnd.rar",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  eml: "message/rfc822", ics: "text/calendar", vcf: "text/vcard", stl: "model/stl", "3mf": "model/3mf", step: "model/step", stp: "model/step",
};
export function attachmentMimeType(filename: string, declaredType = "") {
  const type = declaredType.split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream" && /^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/.test(type)) return type;
  return extensionTypes[filename.split(".").at(-1)?.toLowerCase() || ""] || "application/octet-stream";
}

/** Recognize safe image bytes even when Foxmail declares application/octet-stream. */
export function detectEmailFileType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
  if (starts(255, 216, 255)) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 26 && starts(66, 77)) return "image/bmp";
  if (bytes.length >= 6 && starts(0, 0, 1, 0)) return "image/x-icon";
  if (starts(73, 73, 42, 0) || starts(77, 77, 0, 42)) return "image/tiff";
  if (ascii(4, 4) === "ftyp") {
    const brands = ascii(8, Math.min(56, bytes.length - 8));
    if (/avif|avis/.test(brands)) return "image/avif";
    if (/heic|heix|hevc|hevx/.test(brands)) return "image/heic";
    if (/mif1|msf1/.test(brands)) return "image/heif";
  }
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  return null;
}
const browserInlineTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon", "application/pdf"]);
export function emailAttachmentHeaders(filename: string, declaredType: string, bytes: Uint8Array, download = false) {
  const detected = detectEmailFileType(bytes);
  const type = detected || attachmentMimeType(filename, declaredType);
  // Active documents always download; never execute HTML/SVG on the CRM origin.
  const contentType = /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|(?:text|application)\/(?:javascript|ecmascript))$/.test(type) ? "application/octet-stream" : type;
  const inline = !download && Boolean(detected && browserInlineTypes.has(detected));
  const detectedExtension: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp", "image/x-icon": "ico", "image/avif": "avif", "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
  const usableFilename = detected && attachmentMimeType(filename) === "application/octet-stream" ? `${filename}.${detectedExtension[detected]}` : filename;
  const name = usableFilename.replace(/[\u0000-\u001f\u007f"\\]/g, "_").slice(0, 255).toWellFormed() || "Attachment";
  return {
    "Content-Type": contentType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  };
}
