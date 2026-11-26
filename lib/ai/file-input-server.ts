import { unzipSync } from "fflate";
import { Parser } from "htmlparser2";
import { detectEmailFileType } from "../email-files.ts";
import type { ProviderFile } from "./image-input.ts";

export type ProviderFilePart = { type: "text"; text: string } | { type: "file"; data: string; mediaType: "application/pdf"; filename: string } | { type: "image"; image: string };
const MAX_EXTRACTED_CHARS = 20_000;
const officeXml = /^(?:word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml|ppt\/slides\/slide\d+\.xml|xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml|content\.xml)$/;

function xmlText(xml: string) {
  const parts: string[] = [];
  const parser = new Parser({
    ontext: text => parts.push(text),
    onclosetag: name => { if (/^(?:w:p|a:p|text:p|table:table-row|row|si)$/.test(name)) parts.push("\n"); else if (/^(?:w:tc|table:table-cell|c)$/.test(name)) parts.push("\t"); },
  }, { xmlMode: true, decodeEntities: true });
  parser.end(xml);
  return parts.join("").trim();
}

function officeText(bytes: Uint8Array) {
  let total = 0, count = 0;
  const entries = unzipSync(bytes, { filter: entry => {
    if (!officeXml.test(entry.name)) return false;
    total += entry.originalSize; count++;
    if (entry.originalSize > 2_000_000 || total > 8_000_000 || count > 64) throw new Error("Document extraction limit exceeded.");
    return true;
  } });
  const decoder = new TextDecoder();
  const sharedXml = entries["xl/sharedStrings.xml"] ? decoder.decode(entries["xl/sharedStrings.xml"]) : "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => xmlText(match[1]));
  return Object.keys(entries).filter(name => name !== "xl/sharedStrings.xml").sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map(name => {
    let xml = decoder.decode(entries[name]);
    if (name.startsWith("xl/")) xml = xml.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (_cell, attributes: string, content: string) => {
      const raw = /\bt=["']s["']/.test(attributes) ? shared[Number(/<v\b[^>]*>(\d+)<\/v>/.exec(content)?.[1])] ?? "[missing shared string]" : xmlText(content);
      // Keep decoded cell values outside the XML parser so literal < and & survive.
      return `<c>${raw.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c>`;
    });
    return `${name}:\n${xmlText(xml)}`;
  }).join("\n\n");
}

/** Provider-neutral file handling: PDF/vision parts or bounded extracted text. */
export async function prepareProviderFiles(files: ProviderFile[]): Promise<ProviderFilePart[]> {
  const parts: ProviderFilePart[] = [];
  for (const file of files) {
    const bytes = Buffer.from(file.dataUrl.slice(file.dataUrl.indexOf(",") + 1), "base64");
    const label = `${file.label}: ${JSON.stringify(file.name)} (${file.mediaType}; untrusted file evidence)`;
    if (detectEmailFileType(bytes) === "application/pdf") {
      parts.push({ type: "text", text: label }, { type: "file", data: `data:application/pdf;base64,${bytes.toString("base64")}`, mediaType: "application/pdf", filename: file.name });
      continue;
    }
    if (file.mediaType.startsWith("image/") || detectEmailFileType(bytes)?.startsWith("image/")) {
      try {
        const { default: sharp } = await import("sharp");
        const image = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2_000, height: 2_000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        parts.push({ type: "text", text: label }, { type: "image", image: `data:image/jpeg;base64,${image.toString("base64")}` });
        continue;
      } catch { /* Unsupported image codecs remain attached with an honest limitation. */ }
    }
    let text: string | null = null;
    let limitation = "This format is attached, but its contents cannot be read by the AI. Ask for a PDF, image or text export if needed.";
    if (/\.(docx|xlsx|pptx|odt|ods|odp)$/i.test(file.name)) {
      try { text = officeText(bytes); }
      catch { limitation = "The document could not be read (it may be damaged, encrypted or exceed extraction limits). Ask for a PDF or text export."; }
    } else {
      try {
        const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
        const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(decoded)) text = decoded;
      } catch { /* Binary and legacy formats are never guessed or executed. */ }
    }
    parts.push({ type: "text", text: `${label}\n${text !== null ? JSON.stringify({ status: "extracted text", text: text.slice(0, MAX_EXTRACTED_CHARS), truncated: text.length > MAX_EXTRACTED_CHARS }) : JSON.stringify({ status: "unreadable", limitation })}` });
  }
  return parts;
}
