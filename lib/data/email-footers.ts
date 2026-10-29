import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { appendEmailFooter, footerAssetPattern, type EmailFooter } from "../email-footer.ts";
import { cleanEmailFooter, footerImageSources } from "../email-footer-html.ts";
import { escapeEmailHtml } from "../email-markup.ts";
import { importRemoteEmailImage } from "../remote-email-image.ts";

const bucket = "mailbox-attachments";
export type FooterAttachment = { filename: string; contentType: string; content: Buffer | string; cid?: string };

export async function getUserEmailFooter(userId: string): Promise<EmailFooter | null> {
  const { data, error } = await createSupabaseAdmin().from("email_footers").select("text,html").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Unable to load your email footer. Please try again.");
  return data ? { text: data.text, html: data.html } : null;
}

export async function saveUserEmailFooter(userId: string, input: string) {
  if (input.length > 8_000_000) throw new Error("Footer images must total 5 MB or less.");
  const admin = createSupabaseAdmin();
  const cleaned = cleanEmailFooter(input);
  if ((cleaned.html.match(/<img\b/g) || []).length > 10) throw new Error("A footer supports up to 10 images.");
  for (const src of footerImageSources(cleaned.html).filter((value) => /^https?:\/\//i.test(value))) {
    const dataUrl = await importRemoteEmailImage(src);
    cleaned.html = cleaned.html.replaceAll(`src="${escapeEmailHtml(src)}"`, `src="${dataUrl}"`);
  }
  const images = [...cleaned.html.matchAll(/src="data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+=*)"/g)];
  if (images.reduce((size, image) => size + Buffer.byteLength(image[2], "base64"), 0) > 5_000_000) throw new Error("Footer images must total 5 MB or less.");
  const uploaded: string[] = [];
  try {
    let html = cleaned.html;
    for (const image of images) {
      const bytes = Buffer.from(image[2], "base64");
      const metadata = await sharp(bytes, { animated: true, limitInputPixels: 40_000_000 }).metadata();
      const expected = image[1] === "image/jpeg" ? "jpeg" : image[1].slice(6);
      if (metadata.format !== expected) throw new Error("Choose a valid PNG, JPG, GIF, or WebP image.");
      const id = randomUUID();
      const path = `${userId}/footers/${id}`;
      const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType: image[1], upsert: false });
      if (error) throw new Error("Unable to save a footer image. Please try again.");
      uploaded.push(path);
      html = html.replace(image[0], `src="/api/email/footer/assets/${id}"`);
    }
    if (html.length > 100_000 || cleaned.text.length > 10_000) throw new Error("Keep your footer under 10,000 text characters.");
    const { error } = await admin.from("email_footers").upsert({ user_id: userId, html, text: cleaned.text, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error("Unable to save your email footer. Please try again.");
    // Old image objects remain available to already-open drafts. Sent mail gets
    // its own copy, so a later footer edit never changes an earlier sent email.
    return { html, text: cleaned.text };
  } catch (error) {
    if (uploaded.length) await admin.storage.from(bucket).remove(uploaded);
    throw error;
  }
}

export async function loadFooterImage(userId: string, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Footer image not found.");
  const { data, error } = await createSupabaseAdmin().storage.from(bucket).download(`${userId}/footers/${id}`);
  if (error || !data || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(data.type)) throw new Error("Footer image not found.");
  return data;
}

export async function prepareUserEmail(userId: string, input: { text: string; html?: string; attachments?: FooterAttachment[] }, footerIncluded = false, resolvedFooter?: EmailFooter | null) {
  const footer = footerIncluded ? null : resolvedFooter === undefined ? await getUserEmailFooter(userId) : resolvedFooter;
  const content = footerIncluded ? { text: input.text, html: input.html } : appendEmailFooter(input.text, input.html, footer);
  const attachments = [...(input.attachments || [])];
  let html = content.html;
  if (html) {
    const urls = [...new Set([...html.matchAll(/\bsrc="(\/api\/email\/footer\/assets\/[a-f0-9-]{36})"/gi)].map((match) => match[1]))];
    if (attachments.length + urls.length > 10) throw new Error("An email supports up to 10 images and attachments combined.");
    for (const url of urls) {
      const id = url.match(footerAssetPattern)![1];
      const image = await loadFooterImage(userId, id);
      const cid = `footer-${id}@filazoo.com`;
      attachments.push({ filename: `footer-${id}.${image.type === "image/jpeg" ? "jpg" : image.type.slice(6)}`, content: Buffer.from(await image.arrayBuffer()), contentType: image.type, cid });
      html = html.replaceAll(`src="${url}"`, `src="cid:${cid}"`);
    }
  }
  return { text: content.text, html, attachments };
}
