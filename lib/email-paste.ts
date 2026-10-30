import { inlineImageTypes, maxInlineImageBytes } from "./email-composer.ts";

export function crmClipboardAttachment(src: string, baseURI: string, appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  try {
    const current = new URL(baseURI);
    const configured = appUrl ? new URL(appUrl).origin : current.origin;
    const candidate = new URL(src.replace(/^about:(?:blank|srcdoc)?(?=\/api\/email\/)/i, ""), current);
    const path = `${candidate.pathname}${candidate.search}`;
    return [current.origin, configured, "https://crm.filazoosupply.com"].includes(candidate.origin) && /^\/api\/email\/(?:footer\/assets\/|received-attachment\?|crm-attachment\?|attachments\/)/.test(path) ? path : null;
  } catch { return null; }
}

export async function imageFileDataUrl(file: File) {
  if (!inlineImageTypes.has(file.type)) throw new Error("Choose a PNG, JPG, GIF, WebP, BMP, AVIF, or ICO image. Other formats can be added as file attachments.");
  if (file.size > maxInlineImageBytes) throw new Error("Each inline image must be 7.5 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${file.type};base64,${btoa(binary)}`;
}

/** Import copied webmail images before insertion; their original URLs may need
 * cookies or expire. Never replace an entire formatted signature with a PNG. */
export async function preparePastedEmailHtml(html: string, document: Document, files: File[], request: typeof fetch = fetch, options: { importRemoteImages?: boolean } = {}) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const images = Array.from(template.content.querySelectorAll("img"));
  const imported = new Map<string, Promise<string>>();
  let missing = 0;
  await Promise.all(images.map(async (image, index) => {
    const src = image.getAttribute("src") || image.getAttribute("data-email-image-source") || "";
    // Images copied from this CRM already have an authenticated attachment URL.
    // Read them in the browser so they never go through the public URL importer.
    const ownAttachment = crmClipboardAttachment(src, document.baseURI);
    if (ownAttachment) {
      try {
        const response = await request(ownAttachment);
        if (!response.ok) throw new Error("Image unavailable.");
        const blob = await response.blob();
        image.setAttribute("src", await imageFileDataUrl(new File([blob], "copied-image", { type: blob.type })));
        image.removeAttribute("data-email-image-source");
      } catch { image.remove(); missing++; }
      return;
    }
    if (!/^https?:/i.test(src)) {
      if (image.hasAttribute("data-email-image-source")) {
        if (files.length === images.length) image.setAttribute("src", await imageFileDataUrl(files[index]));
        else { image.remove(); missing++; }
        image.removeAttribute("data-email-image-source");
      }
      return;
    }
    if (options.importRemoteImages === false) return;
    let result = imported.get(src);
    if (!result) {
      result = (async () => {
        const response = await request("/api/email/footer/import-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: src }) });
        const body = await response.json();
        if (!response.ok || !body.dataUrl) throw new Error(body.error || "Unable to copy this image.");
        return body.dataUrl as string;
      })();
      imported.set(src, result);
    }
    try { image.setAttribute("src", await result); }
    catch {
      if (files.length === images.length || (images.length === 1 && files.length === 1)) image.setAttribute("src", await imageFileDataUrl(files[index]));
      else { image.remove(); missing++; }
    }
  }));
  return { html: template.innerHTML, missing };
}
