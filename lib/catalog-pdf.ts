import type { Product, ProductVariant } from "./types.ts";

type CatalogOptions = {
  title?: string;
  customer?: string;
  date?: string;
};

type PdfPage = string[];

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 46;
const INK = "0.075 0.102 0.090";
const MUTED = "0.365 0.400 0.384";
const LINE = "0.875 0.894 0.882";
const PAPER = "0.984 0.980 0.965";
const WHITE = "1 1 1";
const MINT = "0.302 0.827 0.588";
const MINT_PALE = "0.914 0.973 0.941";

function ascii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function plainAscii(value: string) {
  return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
}

function truncate(value: string, max: number) {
  const clean = plainAscii(value).trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function text(
  page: PdfPage,
  value: string,
  x: number,
  y: number,
  size: number,
  options: { bold?: boolean; color?: string; align?: "left" | "right" } = {},
) {
  const safe = ascii(value);
  const estimatedWidth = safe.length * size * (options.bold ? 0.56 : 0.51);
  const drawX = options.align === "right" ? x - estimatedWidth : x;
  page.push(
    `BT /${options.bold ? "FB" : "FR"} ${size} Tf ${options.color ?? INK} rg ${drawX.toFixed(1)} ${y.toFixed(1)} Td (${safe}) Tj ET`,
  );
}

function rect(
  page: PdfPage,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { fill?: string; stroke?: string; lineWidth?: number } = {},
) {
  const commands = ["q"];
  if (options.fill) commands.push(`${options.fill} rg`);
  if (options.stroke) commands.push(`${options.stroke} RG`, `${options.lineWidth ?? 0.8} w`);
  commands.push(`${x} ${y} ${width} ${height} re`);
  commands.push(options.fill && options.stroke ? "B" : options.fill ? "f" : "S", "Q");
  page.push(commands.join(" "));
}

function line(page: PdfPage, x1: number, y1: number, x2: number, y2: number, color = LINE, width = 0.8) {
  page.push(`q ${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q`);
}

function circle(page: PdfPage, x: number, y: number, radius: number, color: string) {
  const k = radius * 0.55228475;
  page.push(
    `q ${color} RG 1.4 w ${x + radius} ${y} m ` +
      `${x + radius} ${y + k} ${x + k} ${y + radius} ${x} ${y + radius} c ` +
      `${x - k} ${y + radius} ${x - radius} ${y + k} ${x - radius} ${y} c ` +
      `${x - radius} ${y - k} ${x - k} ${y - radius} ${x} ${y - radius} c ` +
      `${x + k} ${y - radius} ${x + radius} ${y - k} ${x + radius} ${y} c S Q`,
  );
}

function wordmark(page: PdfPage, y = 744) {
  circle(page, 53, y + 2, 7, MINT);
  circle(page, 53, y + 2, 3, MINT);
  text(page, "FILAZOO", 68, y - 3, 13, { bold: true, color: INK });
}

function footer(page: PdfPage, pageNumber: number) {
  line(page, MARGIN, 40, PAGE_WIDTH - MARGIN, 40);
  text(page, "FILAZOO  /  PRIVATE WHOLESALE CATALOG", MARGIN, 24, 7, { bold: true, color: MUTED });
  text(page, String(pageNumber).padStart(2, "0"), PAGE_WIDTH - MARGIN, 24, 8, { bold: true, color: MUTED, align: "right" });
}

function displayDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(parsed);
}

function priceSummary(product: Product) {
  if (!product.priceTiers.length) return "Quote on request";
  return product.priceTiers.map((tier) => `${tier.minimumQuantity}+ / ${tier.price}`).join("   ");
}

function createCoverPage(products: Product[], options: Required<Pick<CatalogOptions, "title" | "date">> & Pick<CatalogOptions, "customer">) {
  const page: PdfPage = [];
  rect(page, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, { fill: PAPER });
  wordmark(page, 744);
  text(page, "CURATED PRODUCT EDITION", MARGIN, 658, 8, { bold: true, color: MINT });
  text(page, truncate(options.title, 34), MARGIN, 613, 31, { bold: true, color: INK });
  text(page, "Wholesale materials, made simple.", MARGIN, 576, 15, { color: MUTED });
  line(page, MARGIN, 536, PAGE_WIDTH - MARGIN, 536, MINT, 2.4);

  const customer = options.customer?.trim();
  text(page, customer ? "PREPARED FOR" : "CATALOG DETAILS", MARGIN, 487, 7, { bold: true, color: MUTED });
  text(page, customer ? truncate(customer, 40) : "Filazoo wholesale partners", MARGIN, 460, 17, { bold: true });

  rect(page, MARGIN, 340, 154, 76, { fill: WHITE, stroke: LINE });
  text(page, "PRODUCTS", MARGIN + 16, 390, 7, { bold: true, color: MUTED });
  text(page, String(products.length).padStart(2, "0"), MARGIN + 16, 356, 23, { bold: true });

  rect(page, MARGIN + 166, 340, 166, 76, { fill: WHITE, stroke: LINE });
  text(page, "VARIANTS", MARGIN + 182, 390, 7, { bold: true, color: MUTED });
  text(page, String(products.reduce((total, product) => total + product.variants.length, 0)).padStart(2, "0"), MARGIN + 182, 356, 23, { bold: true });

  rect(page, MARGIN + 344, 340, 176, 76, { fill: MINT_PALE, stroke: MINT });
  text(page, "ISSUED", MARGIN + 360, 390, 7, { bold: true, color: MUTED });
  text(page, displayDate(options.date), MARGIN + 360, 359, 11, { bold: true });

  text(page, "Inside", MARGIN, 281, 8, { bold: true, color: MUTED });
  products.slice(0, 5).forEach((product, index) => {
    const y = 249 - index * 28;
    text(page, String(index + 1).padStart(2, "0"), MARGIN, y, 8, { bold: true, color: MINT });
    text(page, truncate(product.name, 46), MARGIN + 34, y, 10, { bold: true });
    text(page, product.sku, PAGE_WIDTH - MARGIN, y, 8, { color: MUTED, align: "right" });
  });
  if (products.length > 5) text(page, `+ ${products.length - 5} more selected products`, MARGIN + 34, 109, 8, { color: MUTED });
  footer(page, 1);
  return page;
}

function specCard(page: PdfPage, label: string, value: string, x: number, y: number, width: number) {
  rect(page, x, y, width, 54, { fill: WHITE, stroke: LINE });
  text(page, label.toUpperCase(), x + 12, y + 34, 6.5, { bold: true, color: MUTED });
  text(page, truncate(value || "Not specified", 24), x + 12, y + 15, 9.5, { bold: true });
}

function variantsFor(product: Product): ProductVariant[] {
  if (product.variants.length) return product.variants;
  return product.colors.map((name, index) => ({
    id: `${product.sku}-${index}`,
    name,
    sku: `${product.sku}-${String(index + 1).padStart(2, "0")}`,
    price: product.price,
    stockStatus: product.stockStatus,
    imageUrl: null,
  }));
}

function productPage(
  product: Product,
  productIndex: number,
  totalProducts: number,
  rows: ProductVariant[],
  pageNumber: number,
  continuation: boolean,
) {
  const page: PdfPage = [];
  rect(page, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, { fill: PAPER });
  wordmark(page, 744);
  text(page, `PRODUCT ${String(productIndex + 1).padStart(2, "0")} / ${String(totalProducts).padStart(2, "0")}`, PAGE_WIDTH - MARGIN, 741, 7, {
    bold: true,
    color: MUTED,
    align: "right",
  });

  if (!continuation) {
    text(page, product.material.toUpperCase(), MARGIN, 682, 8, { bold: true, color: MINT });
    text(page, truncate(product.name, 36), MARGIN, 646, 25, { bold: true });
    rect(page, MARGIN, 600, Math.max(90, product.sku.length * 6.2 + 24), 25, { fill: MINT_PALE });
    text(page, product.sku, MARGIN + 12, 608, 8, { bold: true });

    const gap = 8;
    const cardWidth = (PAGE_WIDTH - MARGIN * 2 - gap * 3) / 4;
    specCard(page, "Material", product.material, MARGIN, 520, cardWidth);
    specCard(page, "Diameter", product.diameter, MARGIN + cardWidth + gap, 520, cardWidth);
    specCard(page, "Pack", product.weight, MARGIN + (cardWidth + gap) * 2, 520, cardWidth);
    specCard(page, "Lead time", product.leadTime, MARGIN + (cardWidth + gap) * 3, 520, cardWidth);

    text(page, "VOLUME PRICING", MARGIN, 484, 7, { bold: true, color: MUTED });
    rect(page, MARGIN, 439, PAGE_WIDTH - MARGIN * 2, 31, { fill: MINT_PALE });
    text(page, truncate(priceSummary(product), 82), MARGIN + 14, 449, 10, { bold: true });
  } else {
    text(page, product.material.toUpperCase(), MARGIN, 682, 8, { bold: true, color: MINT });
    text(page, `${truncate(product.name, 32)} / continued`, MARGIN, 646, 22, { bold: true });
  }

  const tableTop = continuation ? 574 : 401;
  text(page, continuation ? "MORE VARIANTS" : `AVAILABLE VARIANTS  /  ${variantsFor(product).length}`, MARGIN, tableTop + 19, 7, { bold: true, color: MUTED });
  rect(page, MARGIN, tableTop - 20, PAGE_WIDTH - MARGIN * 2, 26, { fill: INK });
  text(page, "VARIANT", MARGIN + 12, tableTop - 11, 6.5, { bold: true, color: WHITE });
  text(page, "SKU", 238, tableTop - 11, 6.5, { bold: true, color: WHITE });
  text(page, "UNIT PRICE", 371, tableTop - 11, 6.5, { bold: true, color: WHITE });
  text(page, "AVAILABILITY", 454, tableTop - 11, 6.5, { bold: true, color: WHITE });

  rows.forEach((variant, index) => {
    const y = tableTop - 49 - index * 27;
    if (index % 2 === 1) rect(page, MARGIN, y - 7, PAGE_WIDTH - MARGIN * 2, 27, { fill: WHITE });
    text(page, truncate(variant.name, 27), MARGIN + 12, y + 2, 8.5, { bold: true });
    text(page, truncate(variant.sku, 21), 238, y + 2, 7.5, { color: MUTED });
    text(page, truncate(variant.price || product.price, 12), 371, y + 2, 8, { bold: true });
    text(page, truncate(variant.stockStatus || product.stockStatus, 19), 454, y + 2, 7.5, { color: MUTED });
    line(page, MARGIN, y - 7, PAGE_WIDTH - MARGIN, y - 7, LINE, 0.45);
  });

  footer(page, pageNumber);
  return page;
}

function serializePdf(pages: PdfPage[]) {
  const pageIds = pages.map((_, index) => 5 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  pages.forEach((commands, index) => {
    const content = commands.join("\n");
    const contentId = pageIds[index] + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /FR 3 0 R /FB 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  let pdf = "%PDF-1.4\n%Filazoo\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function buildCatalogPdf(products: Product[], options: CatalogOptions = {}) {
  const normalizedOptions = {
    title: options.title?.trim() || "Filazoo product catalog",
    customer: options.customer?.trim(),
    date: options.date || new Date().toISOString().slice(0, 10),
  };
  const pages: PdfPage[] = [createCoverPage(products, normalizedOptions)];
  let pageNumber = 2;

  products.forEach((product, productIndex) => {
    const variants = variantsFor(product);
    const firstPageRows = variants.slice(0, 11);
    pages.push(productPage(product, productIndex, products.length, firstPageRows, pageNumber++, false));
    for (let start = 11; start < variants.length; start += 17) {
      pages.push(productPage(product, productIndex, products.length, variants.slice(start, start + 17), pageNumber++, true));
    }
  });

  return serializePdf(pages);
}

export function downloadCatalogPdf(products: Product[], options?: CatalogOptions) {
  const bytes = buildCatalogPdf(products, options);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `filazoo-custom-catalog-${new Date().toISOString().slice(0, 10)}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
