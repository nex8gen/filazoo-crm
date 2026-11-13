import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { simpleParser } from "mailparser";
import { emailDesignSchema, emailDesignText, newEmailBlock, newEmailDesign, renderEmailBlockContent, renderEmailDesign } from "../lib/email-design.ts";
import { emailSocialAsset, emailSocialDefaults, moveEmailSocialLink, newEmailSocialLink } from "../lib/email-social.ts";
import { emailSocialAssets } from "../lib/email-social-assets.ts";
import { prepareComposerMessage } from "../lib/email-composer.ts";
import { emailSendSchema } from "../lib/email-workbench.ts";
import { buildMailboxMime } from "../lib/mailer.ts";

const page = (html: string) => new JSDOM(html).window.document;

test("new social blocks have real default icons and legacy links retain text labels", () => {
  const social = newEmailBlock("social");
  assert.deepEqual(social.links.map(item => item.platform), ["facebook", "instagram", "youtube", "pinterest"]);
  assert.equal(social.social.showLabels, false);
  assert.equal(page(renderEmailBlockContent(social)).querySelectorAll("img").length, 4);
  const old = { ...social, links: [{ label: "Website", href: "https://example.test" }] } as Record<string, unknown>;
  delete old.social;
  const parsed = emailDesignSchema.parse({ ...newEmailDesign(), blocks: [old] });
  assert.equal(parsed.blocks[0].social.showLabels, true);
  assert.equal(page(renderEmailDesign(parsed).html).querySelector("a")!.textContent, "Website");
});

test("platform, icon style, size, labels, custom image, and URLs reach email output safely", () => {
  const block = newEmailBlock("social", { social: { ...emailSocialDefaults, iconColor: "white", iconSize: "large", showLabels: false }, links: [{ ...newEmailSocialLink("instagram"), label: '<img onerror="bad()">', href: "https://example.test/profile?a=1&b=2" }, { ...newEmailSocialLink("custom"), label: "Custom", href: "javascript:bad()", customSrc: "javascript:bad()" }] });
  const doc = page(renderEmailBlockContent(block));
  const img = doc.querySelector("img")!;
  assert.equal(img.getAttribute("src"), emailSocialAsset("instagram", "white"));
  assert.equal(img.getAttribute("width"), "32");
  assert.equal(img.getAttribute("alt"), '<img onerror="bad()">');
  assert.equal(doc.querySelectorAll("a").length, 1);
  assert.equal(doc.querySelectorAll("img").length, 1);
  assert.equal(doc.querySelector("[onerror]"), null);
  block.links[1].customSrc = "https://example.test/custom.png";
  block.social.showLabels = true;
  assert.equal(page(renderEmailBlockContent(block)).querySelectorAll("img")[1].getAttribute("src"), block.links[1].customSrc);
  assert.match(page(renderEmailBlockContent(block)).body.textContent!, /Custom/);
});

test("social item reordering and spacers preserve data, tracking and plain-text reading order", () => {
  const first = { ...newEmailSocialLink("facebook"), href: "https://example.test/facebook" };
  const second = { ...newEmailSocialLink("linkedin"), href: "https://example.test/linkedin" };
  const spacer = { ...newEmailSocialLink("custom", true), spacerWidth: 28, href: "https://not-a-link.test" };
  const links = [first, spacer, second];
  const moved = moveEmailSocialLink(links, 2, 0);
  assert.deepEqual(moved, [second, first, spacer]);
  assert.deepEqual(links, [first, spacer, second]);
  assert.equal(moveEmailSocialLink(links, -1, 0), links);
  const design = { ...newEmailDesign(), blocks: [newEmailBlock("social", { links: moved })] };
  const result = renderEmailDesign(design, { utmCampaign: "social-campaign" });
  const doc = page(result.html);
  assert.deepEqual([...doc.querySelectorAll("[data-social-platform]")].map(node => node.getAttribute("data-social-platform")), ["linkedin", "facebook"]);
  assert.equal(doc.querySelector("[data-social-spacer]")!.getAttribute("width"), "28");
  assert.equal(doc.querySelectorAll("a").length, 2);
  assert.match(doc.querySelector("a")!.getAttribute("href")!, /utm_campaign=social-campaign/);
  assert.ok(result.text.indexOf("LinkedIn") < result.text.indexOf("Facebook"));
  assert.doesNotMatch(emailDesignText(design), /Spacer|not-a-link/);
});

test("mobile stacking, visibility and independent padding are present in preview and exported HTML", () => {
  const block = newEmailBlock("social", { social: { ...emailSocialDefaults, stackMobile: true, gap: 18, paddingX: 7, paddingY: 9, showDesktop: false } });
  const design = { ...newEmailDesign(), blocks: [block] };
  const exported = renderEmailDesign(design).html;
  assert.match(exported, /padding:9px 7px/);
  assert.match(exported, /email-social-hide-desktop/);
  assert.match(exported, /padding:9px 0!important/);
  assert.equal(page(renderEmailBlockContent(block, { viewport: "mobile" })).querySelectorAll("tr").length, 4);
  assert.equal(page(renderEmailBlockContent(block, { viewport: "desktop" })).querySelectorAll("tr").length, 1);
  block.social.showMobile = false;
  assert.match(renderEmailDesign(design).html, /email-social-hide-mobile/);
  assert.equal(emailDesignSchema.safeParse({ ...design, blocks: [{ ...block, social: { ...block.social, gap: 81 } }] }).success, false);
});

test("campaign MIME embeds and deduplicates social PNGs and preserves the file limit", async () => {
  const social = newEmailBlock("social");
  const design = { ...newEmailDesign(), blocks: [social, newEmailBlock("social")] };
  const rendered = renderEmailDesign(design);
  const content = prepareComposerMessage(rendered.text, rendered.html, "");
  assert.equal(content.attachments.length, 4);
  assert.doesNotMatch(content.html, /src="data:/);
  assert.equal(page(content.html).querySelectorAll('img[src^="cid:"]').length, 8);
  const mime = await buildMailboxMime("sender@example.test", { to: "buyer@example.test", subject: "Social icons", html: content.html, attachments: content.attachments.map(file => ({ ...file, content: Buffer.from(file.content, "base64") })) });
  const parsed = await simpleParser(mime, { skipImageLinks: true });
  assert.equal(parsed.attachments.length, 4);
  for (const image of parsed.attachments) { assert.equal(image.contentType, "image/png"); assert.equal(image.content.readUInt32BE(16), 64); assert.equal(image.content.readUInt32BE(20), 64); }
  const files = Array.from({ length: 8 }, (_, i) => ({ filename: `image-${i}.png`, content: "AAAA", cid: `${i}@image.test` }));
  const request = { to: ["buyer@example.test"], subject: "Icons", html: content.html, attachments: [...files, ...content.attachments] };
  assert.equal(emailSendSchema.safeParse(request).success, false);
  const campaign = { id: crypto.randomUUID(), contactId: crypto.randomUUID(), smartSending: false };
  assert.equal(emailSendSchema.safeParse({ ...request, campaign }).success, true);
  assert.equal(emailSendSchema.safeParse({ ...request, campaign, attachments: Array.from({ length: 11 }, () => ({ filename: "file.pdf", content: "AAAA" })) }).success, false);
});

test("every selectable platform has bundled brand, black and white PNGs", () => {
  for (const asset of emailSocialAssets) for (const style of ["brand", "black", "white"] as const) {
    const bytes = Buffer.from(asset.images[style].split(",")[1], "base64");
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    assert.equal(bytes.readUInt32BE(16), 64);
  }
});
