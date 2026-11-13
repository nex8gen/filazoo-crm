/** Rebuild native editor designs and previews from the pinned Colorlib sources.
 * Run: node --experimental-strip-types scripts/convert-email-library.mjs
 * No network requests; original licensed HTML and artwork stay untouched.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { emailDesignSchema, newEmailBlock, newEmailDesign, renderEmailDesign } from "../lib/email-design.ts";

const root = new URL("../", import.meta.url);
const sources = JSON.parse(await readFile(new URL("lib/colorlib-email-templates.json", root), "utf8"));
const zero = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const px = value => Number.parseFloat(value) || 0;
const clean = value => value.replace(/\s+/g, " ").trim();
const isColumn = element => /\bmj-column-per-/.test(element.className || "");

function convert(source) {
  const dom = new JSDOM(source.html);
  const { document } = dom.window;
  const computed = element => dom.window.getComputedStyle(element);
  let sequence = 0;
  function id() {
    const hex = createHash("sha256").update(`${source.id}:editor:${sequence++}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  function color(value, fallback = "transparent") {
    if (!value || value === "transparent" || /rgba\([^)]*,\s*0\)$/.test(value)) return fallback;
    const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) return "#" + match.slice(1, 4).map(n => Number(n).toString(16).padStart(2, "0")).join("");
    if (/^#[\da-f]{6}$/i.test(value)) return value;
    return fallback;
  }
  function padding(element) {
    return Object.fromEntries(["top", "right", "bottom", "left"].map(side => [side, clamp(Math.round(px(element.style.getPropertyValue(`padding-${side}`))), 0, 80)]));
  }
  function text(element) {
    function read(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 || ["STYLE", "SCRIPT"].includes(node.tagName)) return "";
      if (node.tagName === "BR") return "\n";
      const value = [...node.childNodes].map(read).join("");
      return value + (["P", "LI", "TR", "H1", "H2", "H3"].includes(node.tagName) ? "\n" : "");
    }
    const value = read(element).split("\n").map(clean).join("\n").trim();
    return computed(element).textTransform === "uppercase" ? value.toUpperCase() : value;
  }
  function typography(element) {
    const style = computed(element);
    const size = clamp(Math.round(px(style.fontSize) || 16), 8, 64);
    const family = style.fontFamily;
    // The editor only offers email-safe fonts. Serif designs retain a serif fallback.
    const fontFamily = /Georgia|Playfair|Lora|Merriweather/i.test(family) ? "Georgia" : /Times/i.test(family) ? "Times New Roman" : /mono|Courier/i.test(family) ? "Courier New" : "Arial";
    const spacing = style.letterSpacing.endsWith("em") ? px(style.letterSpacing) * size : px(style.letterSpacing);
    const lineHeight = style.lineHeight.endsWith("px") ? px(style.lineHeight) / size : px(style.lineHeight) || 1.6;
    return { fontFamily, fontSize: size, color: color(style.color, "#202020"), bold: px(style.fontWeight) >= 600 || style.fontWeight === "bold", italic: style.fontStyle === "italic", underline: style.textDecorationLine === "underline", align: ["left", "center", "right"].includes(style.textAlign) ? style.textAlign : "left", presentation: { letterSpacing: clamp(spacing, -5, 30), lineHeight: Math.round(clamp(lineHeight, .8, 3) * 10000) / 10000 } };
  }
  function block(type, values = {}) { return { id: id(), type, padding: 0, ...values }; }
  function linkedText(element, inset) {
    if (element.children.length === 1 && ![...element.childNodes].some(node => node.nodeType === 3 && clean(node.textContent))) return linkedText(element.firstElementChild, inset);
    const parts = [...element.children].filter(child => /^(H[1-6]|P)$/.test(child.tagName) || computed(child).display === "block");
    if (parts.length && ![...element.childNodes].some(node => node.nodeType === 3 && clean(node.textContent))) {
      const content = [...element.children].filter(child => clean(child.textContent));
      return content.flatMap((part, index) => linkedText(part, { ...inset, top: index === 0 ? inset.top : 0, bottom: index === content.length - 1 ? inset.bottom : 0 }));
    }
    const links = element.matches("a") ? [element] : [...element.querySelectorAll("a")];
    const onlyLinks = links.length && element.textContent.replace(/[\s·]/g, "") === links.map(a => a.textContent).join("").replace(/\s/g, "");
    if (onlyLinks && links.length <= 10) return [block("header", { text: "", links: links.map(a => ({ label: clean(a.textContent), href: a.getAttribute("href") || "" })), ...typography(element), presentation: { padding: inset, header: { mobileLayout: "links-only", layout: "stacked", gap: 0, linkSize: typography(element).fontSize, linkColor: typography(element).color, linkPadding: { top: 0, right: 8, bottom: 0, left: 0 } } } })];
    const value = text(element);
    if (!value) return [];
    const style = typography(element);
    const result = [block("text", { text: value, ...style, presentation: { ...style.presentation, padding: inset } })];
    // Standalone linked copy remains directly editable as a native button.
    if (links.length === 1 && clean(links[0].textContent) === clean(element.textContent)) {
      result[0] = block("button", { text: value, href: links[0].getAttribute("href") || "", ...style, background: "transparent", presentation: { ...style.presentation, padding: inset, button: { padding: zero() } } });
    } else {
      // Preserve public destinations in paragraphs without inventing a destination
      // for the original demo '#' links.
      for (const link of links.filter(a => /^(https?:|mailto:|tel:)/i.test(a.getAttribute("href") || ""))) {
        result.push(block("button", { text: clean(link.textContent), href: link.getAttribute("href"), ...typography(link), background: "transparent", presentation: { padding: { ...zero(), left: inset.left, right: inset.right }, button: { padding: zero() } } }));
      }
    }
    return result;
  }
  function leaf(td) {
    const element = td.firstElementChild;
    if (!element) return [];
    const inset = padding(td);
    const image = element.matches("img") ? element : element.querySelector("img");
    const images = [...element.querySelectorAll("img")];
    if (images.length > 1 && !clean(element.textContent)) return [block("header", { text: "", links: images.map(img => ({ label: img.getAttribute("alt") || "Social link", href: img.closest("a")?.getAttribute("href") || "", customSrc: img.getAttribute("src") })), width: 24, align: td.getAttribute("align") || "center", presentation: { padding: inset, header: { mobileLayout: "links-only", layout: "stacked", gap: 0, linkPadding: { top: 0, right: 8, bottom: 0, left: 0 } } } })];
    if (image && !clean(element.textContent)) {
      const width = clamp(Math.round(px(image.getAttribute("width")) || px(image.closest("td")?.style.width) || px(image.style.width) || 560), 20, 1200);
      const fill = width >= 200 && image.style.width === "100%";
      return [block("image", { src: image.getAttribute("src"), alt: image.getAttribute("alt") || "", href: image.closest("a")?.getAttribute("href") || "", width, radius: clamp(Math.round(px(image.style.borderRadius)), 0, 40), align: td.getAttribute("align") || "center", presentation: { padding: inset, image: { fill, fillMobile: fill, lockAspect: true } } })];
    }
    const button = element.querySelector('a[style*="inline-block"], p[style*="inline-block"]');
    if (button) {
      const style = typography(button);
      return [block("button", { text: text(button), href: button.getAttribute("href") || "", ...style, align: td.getAttribute("align") || "center", background: color(computed(button).backgroundColor, color(computed(button.parentElement).backgroundColor, "#121212")), radius: clamp(Math.round(px(button.style.borderRadius)), 0, 40), presentation: { ...style.presentation, padding: inset, button: { padding: padding(button) } } })];
    }
    if (element.tagName === "P" && px(element.style.borderTopWidth)) {
      return [block("divider", { height: Math.max(1, Math.round(px(element.style.borderTopWidth))), color: color(computed(element).borderTopColor, "#dddddd"), presentation: { padding: inset } })];
    }
    if (element.querySelector("tr")) {
      const rows = [...element.querySelectorAll("tr")].filter(tr => !tr.querySelector("tr")).map(tr => [...tr.children].map(cell => text(cell).slice(0, 500))).filter(row => row.length);
      if (rows.length && rows.length <= 20 && rows.every(row => row.length <= 6)) {
        const table = block("table", { rows, ...typography(element), presentation: { padding: inset } });
        if (!images.length) return [table];
        const layout = block("columns", { editorVariant: "split", columnCount: 2, presentation: { padding: inset, columns: { widths: [10, 90], gap: 8, stack: "none" } } });
        table.parentId = layout.id; table.column = 1; table.presentation.padding = zero();
        return [layout, ...images.map(img => block("image", { src: img.getAttribute("src"), alt: img.getAttribute("alt") || "", width: clamp(px(img.getAttribute("width")) || 24, 20, 1200), parentId: layout.id, column: 0 })), table];
      }
    }
    return linkedText(element, inset);
  }
  function walk(element, inheritedBackground = "#ffffff") {
    if (["SCRIPT", "STYLE", "LINK", "META"].includes(element.tagName) || element.style.display === "none") return [];
    if (element.tagName === "TD" && element.style.wordBreak === "break-word") return leaf(element);
    if (element.tagName === "IMG") return [block("image", { src: element.getAttribute("src"), alt: element.getAttribute("alt") || "", href: element.closest("a")?.getAttribute("href") || "", width: clamp(px(element.getAttribute("width")) || 24, 20, 1200), align: "center" })];
    const icons = [...element.querySelectorAll("img")];
    if (element.tagName === "TABLE" && icons.length > 1 && icons.length <= 10 && icons.every(img => px(img.getAttribute("width")) > 0 && px(img.getAttribute("width")) <= 60) && !clean(element.textContent)) {
      return [block("header", { text: "", width: 24, align: element.getAttribute("align") || "center", links: icons.map(img => ({ label: img.getAttribute("alt") || "Social link", href: img.closest("a")?.getAttribute("href") || "", customSrc: img.getAttribute("src") })), presentation: { header: { mobileLayout: "links-only", gap: 0, linkPadding: { top: 0, right: 8, bottom: 0, left: 0 } } } })];
    }
    const background = color(element.style.backgroundColor);
    const effectiveBackground = background === "transparent" ? inheritedBackground : background;
    const image = element.getAttribute("background") || element.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1] || "";
    const inset = padding(element);
    const columns = [...element.children].filter(isColumn);
    let result;
    if (columns.length >= 2) {
      if (columns.length > 3) throw new Error(`${source.name}: too many columns`);
      const widths = columns.map(col => px(col.className.match(/mj-column-per-([\d-]+)/)?.[1].replaceAll("-", ".")) || 50);
      const total = widths.reduce((a, b) => a + b, 0);
      const layout = block("columns", { columnCount: columns.length, editorVariant: columns.length === 2 ? "split" : "columns", presentation: { columns: { widths: widths.map(width => width / total * 100), gap: 0, stack: element.style.direction === "rtl" ? "right" : "left" } } });
      result = [layout, ...columns.flatMap((col, column) => walk(col, effectiveBackground).map(item => item.parentId ? item : { ...item, parentId: layout.id, column }))];
    } else {
      result = [...element.children].flatMap(child => walk(child, effectiveBackground));
    }
    if (!result.length && image) return [block("image", { src: image, alt: "", width: 600, presentation: { image: { fill: true, fillMobile: true } } })];
    if (!result.length) return [];
    const hasPadding = Object.values(inset).some(Boolean);
    const hasBackground = background !== "transparent" && background !== inheritedBackground;
    if (hasPadding || hasBackground || image) {
      const outer = block("section", { editorVariant: "section", background: hasBackground ? background : "transparent", presentation: { padding: inset, ...(image ? { backgroundImage: image, minHeight: clamp(Math.round(px(element.style.height)), 0, 1200) } : {}) } });
      // Fold single-root containers into the existing block to avoid artificial
      // nesting in the editor's layers panel.
      const children = result.filter(item => !item.parentId);
      if (children.length === 1 && !image) {
        const child = children[0];
        const childPadding = child.presentation?.padding || zero();
        child.presentation = { ...child.presentation, padding: Object.fromEntries(Object.keys(inset).map(side => [side, clamp(inset[side] + childPadding[side], 0, 80)])), ...(hasBackground ? { blockBackground: background } : {}) };
      } else {
        result = [outer, ...result.map(item => item.parentId ? item : { ...item, parentId: outer.id, column: 0 })];
      }
    }
    return result;
  }
  const design = newEmailDesign();
  design.theme.background = color(computed(document.body).backgroundColor, "#f3f6f6");
  design.theme.width = clamp([...document.querySelectorAll('[style*="max-width:"]')].map(el => px(el.style.maxWidth)).find(width => width >= 320) || 600, 320, 900);
  const content = [...document.querySelectorAll('[style*="max-width:"]')].find(el => px(el.style.maxWidth) >= 320);
  design.theme.contentBackground = color(content?.style.backgroundColor, design.theme.background);
  design.theme.marginTop = 0;
  design.blocks = walk(document.body, design.theme.background).map(item => newEmailBlock(item.type, item));
  const validated = emailDesignSchema.parse(design);
  dom.window.close();
  return validated;
}

const templates = [];
for (const source of sources) {
  const design = convert(source);
  const preview = `/email-template-assets/colorlib/${source.sourceId}/editor.html`;
  const compact = { ...design, blocks: design.blocks.map(item => {
    // JSON is expanded by the schema, whose defaults are independent of type.
    const defaults = newEmailBlock("text", { id: item.id, type: item.type, text: "" });
    return Object.fromEntries(Object.entries(item).filter(([key, value]) => ["id", "type"].includes(key) || JSON.stringify(value) !== JSON.stringify(defaults[key])));
  }) };
  templates.push({ id: source.id, design: compact, preview });
  await writeFile(new URL(`public${preview}`, root), renderEmailDesign(design, { preview: true }).html);
  console.log(`${source.name}: ${design.blocks.length} editable blocks`);
}
await writeFile(new URL("lib/colorlib-email-designs.json", root), JSON.stringify(templates) + "\n");
