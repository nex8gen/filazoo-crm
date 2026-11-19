import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeProductDescription } from "../lib/product-content.ts";
import { productMediaFromTags, productMediaTag } from "../lib/product-images.ts";

test("product descriptions preserve formatting and remove unsafe markup from pasted or source HTML", () => {
  const html = sanitizeProductDescription('<h2 onclick="bad()">Included</h2><p style="text-align:center;color:#2563eb;position:fixed">Three <strong>spools</strong></p><ul><li>White</li></ul><script>bad()</script><iframe src="https://bad.test"></iframe><a href="javascript:bad()">Unsafe</a><img src="data:image/svg+xml;base64,AAAA" onerror="bad()"><a href="https://example.com">Details</a>');
  assert.match(html, /<h2>Included<\/h2>/);
  assert.match(html, /text-align:center;color:#2563eb/);
  assert.match(html, /<strong>spools<\/strong>/);
  assert.match(html, /<ul><li>White<\/li><\/ul>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /onclick|onerror|position|script|iframe|javascript|data:image/);
  assert.equal(sanitizeProductDescription(html), html);
});

test("legacy plain descriptions and explicitly empty descriptions remain readable", () => {
  assert.equal(sanitizeProductDescription("Weight < 3 kg\nPLA & PETG"), "<p>Weight &lt; 3 kg<br>PLA &amp; PETG</p>");
  assert.equal(sanitizeProductDescription(""), "");
});

test("media metadata preserves order and explicit removal without restoring variant images", () => {
  const urls = ["https://example.com/cover.jpg", "/quotation-2610/PLA/white.png"];
  assert.deepEqual(productMediaFromTags([productMediaTag(urls)], ["https://example.com/old.jpg"]), urls);
  assert.deepEqual(productMediaFromTags([productMediaTag([])], urls), []);
  assert.deepEqual(productMediaFromTags(["media-json:broken"], urls), urls);
});
