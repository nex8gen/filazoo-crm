import assert from "node:assert/strict";
import test from "node:test";
import { attachmentMimeType, detectEmailFileType, emailAttachmentHeaders } from "../lib/email-files.ts";
import { decodeEmailFilename, emailMimeParameter } from "../lib/email-mime.ts";
import { plainEmailContentHtml, resolveEmailContentIds, isInlineEmailAttachment } from "../lib/email-content.ts";
import { prepareComposerMessage } from "../lib/email-composer.ts";
import { imageFileDataUrl } from "../lib/email-paste.ts";

test("generic Foxmail BMP icons are served as inline images without changing the original bytes", () => {
  const bmp = Buffer.from("424d5a0d000000000000360000002800000001000000010000000100", "hex");
  const copy = Buffer.from(bmp);
  const headers = emailAttachmentHeaders("3418_3418_A3E481.A60F716800000000", "application/octet-stream", bmp);
  assert.equal(headers["Content-Type"], "image/bmp");
  assert.match(headers["Content-Disposition"], /^inline;/);
  assert.match(headers["Content-Disposition"], /A60F716800000000\.bmp/);
  assert.deepEqual(bmp, copy);
  assert.match(emailAttachmentHeaders("icon", "application/octet-stream", bmp, true)["Content-Disposition"], /^attachment;/);
});
test("browser images are detected from actual bytes, while unsupported previews retain download access", () => {
  for (const [signature, mime] of [
    ["89504e470d0a1a0a", "image/png"], ["ffd8ff", "image/jpeg"], ["474946383961", "image/gif"],
    ["524946460000000057454250", "image/webp"], ["000001000100", "image/x-icon"], ["0000001866747970617669660000000061766966", "image/avif"],
  ]) assert.equal(detectEmailFileType(Buffer.from(signature, "hex")), mime);
  const tiff = emailAttachmentHeaders("scan.tiff", "application/octet-stream", Buffer.from("49492a0000000000", "hex"));
  assert.equal(tiff["Content-Type"], "image/tiff");
  assert.match(tiff["Content-Disposition"], /^attachment;/);
  const heic = emailAttachmentHeaders("photo.heic", "application/octet-stream", Buffer.from("00000018667479706865696300000000", "hex"));
  assert.equal(heic["Content-Type"], "image/heic");
  assert.match(heic["Content-Disposition"], /^attachment;/);
});
test("blank MIME types do not block ZIP, CAD, presentations, video, or unknown file attachments", () => {
  for (const filename of ["files.zip", "part.stl", "deck.pptx", "clip.mp4", "email.eml", "unknown.custom"]) {
    const type = attachmentMimeType(filename, "");
    assert.ok(type.includes("/"));
    assert.match(emailAttachmentHeaders(filename, type, Buffer.from("file bytes"))["Content-Disposition"], /^attachment;/);
  }
  assert.equal(attachmentMimeType("part.stl"), "model/stl");
  assert.equal(attachmentMimeType("files.zip", "application/octet-stream"), "application/zip");
  assert.equal(attachmentMimeType("unknown.custom"), "application/octet-stream");
});
test("active documents download and international filenames cannot inject response headers", () => {
  for (const type of ["text/html", "image/svg+xml", "application/javascript"]) {
    const headers = emailAttachmentHeaders("file", type, Buffer.from("<script>bad()</script>"));
    assert.equal(headers["Content-Type"], "application/octet-stream");
    assert.match(headers["Content-Disposition"], /^attachment;/);
  }
  const disposition = emailAttachmentHeaders("报告\r\n\".pdf", "application/pdf", Buffer.from("%PDF-test"))["Content-Disposition"];
  assert.doesNotMatch(disposition, /[\r\n]/);
  assert.match(disposition, /filename\*=UTF-8''%E6%8A%A5%E5%91%8A/);
});
test("RFC 2047 and RFC 2231 filenames decode without mixing up text file attachments and body parts", () => {
  assert.equal(decodeEmailFilename("=?utf-8?B?5oql5ZGKLnBkZg==?="), "报告.pdf");
  assert.equal(emailMimeParameter({ filename: "=?utf-8?B?5oql5ZGKLnBkZg==?=" }, "filename"), "报告.pdf");
  assert.equal(emailMimeParameter({ "filename*0*": "utf-8''%E6%8A%A5", "filename*1*": "%E5%91%8A.txt" }, "filename"), "报告.txt");
  assert.equal(emailMimeParameter({ "filename*": "utf-8''caf%C3%A9.zip" }, "filename"), "café.zip");
});
test("plain CID signatures recover images while leaving unknown images visible and escaping untrusted text", () => {
  const html = plainEmailContentHtml('Hi <script>bad()</script>\n[cid:_Foxmail.1@logo]\n[cid:missing]\nhttps://example.test', [{ cid: "_Foxmail.1@logo", filename: "Icon", url: "/api/email/received-attachment?uid=1&part=7" }])!;
  assert.match(html, /<img src="\/api\/email\/received-attachment\?uid=1&amp;part=7" alt="Icon">/);
  assert.match(html, /Image unavailable/);
  assert.doesNotMatch(html, /\[cid:|<script>/);
  assert.match(html, /href="https:\/\/example.test"/);
  assert.equal(plainEmailContentHtml("Plain mail with no image markers", []), null);
});
test("CID and Content-Location support preserves embedded files while keeping inline PDFs downloadable", () => {
  const files = [{ cid: "Logo@Mail", contentType: "application/octet-stream", url: "/api/email/received-attachment?uid=1&part=7" }, { contentLocation: "image001.png", contentType: "image/png", url: "/api/email/received-attachment?uid=1&part=8" }];
  const html = resolveEmailContentIds('<img src="CID:%3clogo%40mail%3e"><img src="image001.png">', files);
  assert.doesNotMatch(html, /src="(?:CID:|image001)/);
  assert.equal(isInlineEmailAttachment(files[0], html), true);
  assert.equal(isInlineEmailAttachment(files[1], html), true);
  assert.equal(isInlineEmailAttachment({ inline: true, cid: "pdf", contentType: "application/pdf", url: "/file.pdf" }, '<a href="/file.pdf">file</a>'), false);
  assert.equal(isInlineEmailAttachment({ cid: "unused", contentType: "image/png", url: "/unused" }, html), false);
});

test("copying and forwarding a BMP keeps its original bytes and sends it as a CID image", async () => {
  const bmp = Buffer.from("424d5a0d000000000000360000002800000001000000010000000100", "hex");
  const url = await imageFileDataUrl(new File([bmp], "icon.bmp", { type: "image/bmp" }));
  const message = prepareComposerMessage("Signature", `<p>Signature<img src="${url}"></p>`, "");
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].contentType, "image/bmp");
  assert.deepEqual(Buffer.from(message.attachments[0].content, "base64"), bmp);
  assert.match(message.html, /src="cid:/);
  assert.doesNotMatch(message.html, /data:image/);
});
