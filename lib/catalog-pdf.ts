import type { Product, ProductVariant } from "./types.ts";

export type CatalogImage = { bytes: Uint8Array; width: number; height: number };
export type CatalogOptions = {
  title?: string;
  customer?: string;
  date?: string;
  /** JPEG images, keyed by their CRM URL. Populated by the browser at export time. */
  images?: Map<string, CatalogImage>;
};

export const DEFAULT_CATALOG_IMAGE = "/catalog-default-product.jpg";
const W = 842, H = 595, M = 22, TOP = 466, BOTTOM = 44;
const INK = "0.12 0.15 0.17", RULE = "0.38 0.42 0.44";
const PRICE_COLORS = ["0.976 0.858 0.878", "1 0.889 0.439", "0.588 0.686 0.859", "0.827 0.878 0.965", "0.886 0.937 0.843"];
type Page = string[];

// Helvetica's proportional metrics, in thousandths of an em.
function measure(value: string, size: number) {
  return [...value].reduce((sum, char) => sum + (" ilI.,:;!'|".includes(char) ? 250 : "mwMW@%".includes(char) ? 850 : /[A-Z]/.test(char) ? 660 : 530), 0) * size / 1000;
}
function clean(value: string) {
  return value.normalize("NFKD").replace(/[–—]/g, "-").replace(/[^\x20-\x7e\n]/g, "");
}
function wrap(value: string, width: number, size: number) {
  const lines: string[] = [];
  for (const paragraph of clean(value).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && measure(`${line} ${word}`, size) > width) { lines.push(line); line = ""; }
      for (const char of word) {
        if (measure(line + char, size) > width && line) { lines.push(line); line = ""; }
        line += char;
      }
      line += " ";
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
function text(page: Page, value: string, x: number, y: number, size = 8, bold = false, align: "left" | "center" = "left") {
  const printable = clean(value);
  const escaped = printable.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  page.push(`BT /${bold ? "FB" : "FR"} ${size} Tf ${INK} rg ${(x - (align === "center" ? measure(printable, size) / 2 : 0)).toFixed(2)} ${y.toFixed(2)} Td (${escaped}) Tj ET`);
}
function block(page: Page, value: string, x: number, top: number, width: number, size = 7, bold = false, center = false) {
  const lines = wrap(value, width, size);
  lines.forEach((line, i) => text(page, line, center ? x + width / 2 : x, top - size - i * size * 1.35, size, bold, center ? "center" : "left"));
  return lines.length * size * 1.35;
}
function rect(page: Page, x: number, y: number, width: number, height: number, fill?: string) {
  page.push(`q ${RULE} RG 0.45 w ${fill ? `${fill} rg` : ""} ${[x, y, width, height].map(n => n.toFixed(3)).join(" ")} re ${fill ? "B" : "S"} Q`);
}
function line(page: Page, x: number, y: number, x2: number, y2: number) {
  page.push(`q ${RULE} RG 0.45 w ${x} ${y} m ${x2} ${y2} l S Q`);
}

export function catalogVariantImage(product: Product, variant?: ProductVariant) {
  return variant?.imageUrl || product.imageUrl || DEFAULT_CATALOG_IMAGE;
}
function variantsFor(product: Product): ProductVariant[] {
  if (product.variants.length) return product.variants;
  // Only use known CRM values; do not manufacture variant SKUs.
  return (product.colors.length ? product.colors : [product.color || "Not specified"]).map((name, index) => ({
    id: `${product.sku}-${index}`, name, sku: "", price: product.price,
    stockStatus: product.stockStatus, imageUrl: null,
  }));
}
function specs(product: Product) {
  return [product.sku, `Diameter: ${product.diameter || "Not specified"}`, `Pack: ${product.weight || "Not specified"}`,
    `MOQ: ${product.moq ?? "Not specified"}`, product.stockStatus, product.leadTime, product.status].filter(Boolean).join("\n");
}
function variantDetails(product: Product, variant: ProductVariant) {
  return [variant.name, variant.sku,
    variant.price && variant.price !== product.price ? `Unit: ${variant.price}` : "",
    variant.stockStatus !== product.stockStatus ? variant.stockStatus : ""].filter(Boolean).join("\n");
}

/** Landscape quotation table. The input is the current CRM selection, never reference-PDF data. */
export function buildCatalogPdf(products: Product[], options: CatalogOptions = {}) {
  const images = options.images ?? new Map<string, CatalogImage>();
  const imageNames = new Map([...images.keys()].map((url, i) => [url, `I${i}`]));
  const tierCount = Math.max(0, ...products.map(p => p.priceTiers.length));
  // Each product retains its own quantity breaks; mixed materials need no empty columns.
  const listPrices = tierCount > 5;
  const columns = listPrices || !tierCount ? 1 : tierCount;
  const materialW = 48, typeW = 123, priceW = listPrices ? 140 : columns * 53;
  const gridX = M + materialW + typeW, priceX = W - M - priceW;
  const gridW = priceX - gridX, across = Math.max(1, Math.floor(gridW / 46)), cellW = gridW / across;
  const pages: Page[] = [];
  const title = options.title?.trim() || "Filazoo product quotation";
  const date = options.date || new Date().toISOString().slice(0, 10);
  let page: Page = [], y = TOP;

  function newPage() {
    page = []; pages.push(page); y = TOP;
    const headerHeight = Math.max(62, wrap(title, 540, 17).length * 23 + (options.customer ? wrap(`Prepared for: ${options.customer}`, 540, 8).length * 11 : 0) + 20);
    if (headerHeight > 100) throw new Error("Please shorten the catalog title or customer name to fit the quotation header.");
    rect(page, M, TOP + 32, W - M * 2, 75);
    text(page, "FILAZOO", M + 14, H - 48, 15, true);
    block(page, title, M + 138, H - 27, 540, 15, true, true);
    if (options.customer?.trim()) block(page, `Prepared for: ${options.customer.trim()}`, M + 138, TOP + 51, 540, 8, false, true);
    text(page, `${date}  |  ${products.length} products`, M + 14, H - 70, 7);
    rect(page, M, TOP, materialW, 32); block(page, "Material", M + 3, TOP + 23, materialW - 6, 8, true, true);
    rect(page, M + materialW, TOP, typeW, 32); block(page, "Type / specifications", M + materialW + 3, TOP + 23, typeW - 6, 8, true, true);
    rect(page, gridX, TOP, gridW, 32); text(page, "Color / variant", gridX + gridW / 2, TOP + 12, 9, true, "center");
    for (let i = 0; i < columns; i++) {
      const width = priceW / columns;
      rect(page, priceX + i * width, TOP, width, 32, PRICE_COLORS[i % PRICE_COLORS.length]);
      block(page, listPrices ? "EXW volume pricing" : !tierCount ? "Unit price" : `Tier ${i + 1}\nEXW unit price`, priceX + i * width + 3, TOP + 27, width - 6, 6.3, false, true);
    }
  }

  newPage();
  let materialStart = y, lastMaterial = "";
  function finishMaterial() {
    if (!lastMaterial || materialStart === y) return;
    rect(page, M, y, materialW, materialStart - y, "0.675 0.902 0.886");
    block(page, lastMaterial, M + 4, y + (materialStart - y) / 2 + 9, materialW - 8, 8, true, true);
  }
  products.forEach((product, productIndex) => {
    const variants = variantsFor(product);
    const sortedTiers = [...product.priceTiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity);
    const nameHeight = wrap(product.name, typeW - 12, 9).length * 12;
    const specHeight = wrap(specs(product), typeW - 12, 6.5).length * 8.8;
    const priceList = product.priceTiers.length ? product.priceTiers.map(t => `${t.minimumQuantity}+ pcs: ${t.price}`).join("\n") : product.price || "Quote on request";
    const minHeight = Math.max(110, nameHeight + specHeight + 24, listPrices ? wrap(priceList, priceW - 10, 8).length * 11 + 16 : 0);
    if (minHeight > TOP - BOTTOM) throw new Error(`Product ${product.sku} has too much specification text for a quotation row.`);
    let start = 0;
    while (start < variants.length) {
      const next = variants.slice(start, start + across);
      const cellHeight = Math.max(...next.map(v => 62 + wrap(variantDetails(product, v), cellW - 6, 5.7).length * 7.7));
      const needed = Math.max(minHeight, cellHeight);
      if (needed > TOP - BOTTOM) throw new Error(`Product ${product.sku} has too much variant text for a quotation row.`);
      if (y - needed < BOTTOM) { finishMaterial(); newPage(); lastMaterial = ""; materialStart = y; }
      if (lastMaterial !== product.material) { finishMaterial(); lastMaterial = product.material || "Not specified"; materialStart = y; }
      const top = y;
      // Fit as many complete grid rows as possible; repeat product details on continuation pages.
      let rowsHeight = 0;
      const rows: { variants: ProductVariant[]; height: number }[] = [];
      while (start < variants.length) {
        const row = variants.slice(start, start + across);
        const height = Math.max(...row.map(v => 62 + wrap(variantDetails(product, v), cellW - 6, 5.7).length * 7.7));
        if (Math.max(minHeight, rowsHeight + height) > top - BOTTOM) break;
        rows.push({variants: row, height}); rowsHeight += height; start += row.length;
      }
      const height = Math.max(minHeight, rowsHeight);
      y -= height;
      rect(page, M + materialW, y, typeW, height, productIndex % 2 ? "0.800 0.890 0.733" : "0.718 0.784 0.902");
      const used = block(page, `${product.name}${start < variants.length ? " (continued)" : ""}`, M + materialW + 6, top - 7, typeW - 12, 9, true);
      block(page, specs(product), M + materialW + 6, top - 14 - used, typeW - 12, 6.5);
      let rowTop = top;
      for (const row of rows) {
        for (let i = 0; i < across; i++) {
          const x = gridX + i * cellW;
          rect(page, x, rowTop - row.height, cellW, row.height);
          const variant = row.variants[i];
          if (!variant) continue;
          const url = catalogVariantImage(product, variant);
          const actual = images.get(url), fallback = images.get(DEFAULT_CATALOG_IMAGE);
          const img = actual ?? fallback, imageName = imageNames.get(actual ? url : DEFAULT_CATALOG_IMAGE);
          if (img && imageName) {
            const scale = Math.min((cellW - 6) / img.width, 44 / img.height);
            const iw = img.width * scale, ih = img.height * scale;
            page.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${(x + (cellW - iw) / 2).toFixed(2)} ${(rowTop - 47 + (44 - ih) / 2).toFixed(2)} cm /${imageName} Do Q`);
          } else {
            rect(page, x + 9, rowTop - 40, cellW - 18, 31, "0.94 0.95 0.95");
            text(page, "PHOTO", x + cellW / 2, rowTop - 28, 6, false, "center");
          }
          const isDefault = url === DEFAULT_CATALOG_IMAGE || !actual;
          if (isDefault) text(page, "Default photo", x + cellW / 2, rowTop - 52, 4.8, false, "center");
          block(page, variantDetails(product, variant), x + 3, rowTop - 56, cellW - 6, 5.7, false, true);
        }
        rowTop -= row.height;
      }
      if (rowTop - y > 0.01) { rect(page, gridX, y, gridW, rowTop - y); }
      for (let i = 0; i < columns; i++) {
        const width = priceW / columns;
        rect(page, priceX + i * width, y, width, height, PRICE_COLORS[i % PRICE_COLORS.length]);
        const tier = sortedTiers[i];
        const value = listPrices ? priceList : !tierCount ? product.price || "Quote on request" : tier ? `${tier.minimumQuantity}+ pcs\n${tier.price}` : i === 0 && !sortedTiers.length ? product.price || "Quote on request" : "-";
        const lines = wrap(value, width - 8, 8).length;
        block(page, value, priceX + i * width + 4, y + height / 2 + lines * 5.5, width - 8, 8, true, true);
      }
    }
  });
  finishMaterial();
  if (!products.length) text(page, "No products selected.", M + 12, TOP - 30, 10);
  pages.forEach((p, index) => {
    line(p, M, 30, W - M, 30);
    text(p, "FILAZOO  |  Default photos are illustrative.  |  - = no additional CRM price tier.", M, 18, 6.5);
    text(p, `${index + 1} / ${pages.length}`, W - M - 30, 18, 7);
  });
  return serializePdf(pages, images, imageNames);
}

function serializePdf(pages: Page[], images: Map<string, CatalogImage>, imageNames: Map<string, string>) {
  const encoder = new TextEncoder();
  const objects: Uint8Array[] = [];
  const add = (value: string) => objects.push(encoder.encode(value));
  const imageStart = 5 + pages.length * 2;
  const resources = [...imageNames.values()].map((name, i) => `/${name} ${imageStart + i} 0 R`).join(" ");
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  pages.forEach((page, i) => {
    const content = page.join("\n");
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /FR 3 0 R /FB 4 0 R >> /XObject << ${resources} >> >> /Contents ${6 + i * 2} 0 R >>`);
    add(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
  });
  for (const img of images.values()) {
    const head = encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
    const tail = encoder.encode("\nendstream");
    const object = new Uint8Array(head.length + img.bytes.length + tail.length);
    object.set(head); object.set(img.bytes, head.length); object.set(tail, head.length + img.bytes.length); objects.push(object);
  }
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n%Filazoo\n")], offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, i) => {
    offsets.push(length);
    const head = encoder.encode(`${i + 1} 0 obj\n`), tail = encoder.encode("\nendobj\n");
    chunks.push(head, object, tail); length += head.length + object.length + tail.length;
  });
  chunks.push(encoder.encode(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0; for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; }
  return result;
}

/** Convert CRM photos to PDF-safe JPEGs; unavailable/CORS-blocked photos use the default. */
async function loadCatalogImage(url: string): Promise<CatalogImage | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
      return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height } : null;
    } finally { bitmap.close(); }
  } catch { return null; }
}

export async function buildCatalogPdfWithImages(products: Product[], options?: CatalogOptions) {
  const urls = [...new Set([DEFAULT_CATALOG_IMAGE, ...products.flatMap(p => variantsFor(p).map(v => catalogVariantImage(p, v)))])];
  const images = new Map<string, CatalogImage>();
  // Bound concurrent image decoding for large catalogs.
  for (let start = 0; start < urls.length; start += 6) {
    const batch = await Promise.all(urls.slice(start, start + 6).map(async url => [url, await loadCatalogImage(url)] as const));
    for (const [url, img] of batch) if (img) images.set(url, img);
  }
  return buildCatalogPdf(products, { ...options, images });
}

export async function downloadCatalogPdf(products: Product[], options?: CatalogOptions) {
  const bytes = await buildCatalogPdfWithImages(products, options);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url; link.download = `filazoo-custom-catalog-${new Date().toISOString().slice(0, 10)}.pdf`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
