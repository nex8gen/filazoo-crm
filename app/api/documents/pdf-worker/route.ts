import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Serve the matching PDF.js worker locally; private PDFs never go to a CDN or
// third-party viewer. This endpoint contains public library code only.
export async function GET() {
  const worker = await readFile(join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"));
  return new Response(new Uint8Array(worker), { headers: {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  } });
}
