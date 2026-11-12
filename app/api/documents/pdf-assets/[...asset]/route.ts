import { readFile } from "node:fs/promises";
import { join } from "node:path";
const assetFolders = new Set(["cmaps", "standard_fonts", "wasm"]);

// Only public PDF.js fonts, character maps and decoders; never document storage.
export async function GET(_request: Request, { params }: { params: Promise<{ asset: string[] }> }) {
  const { asset } = await params;
  if (asset.length !== 2 || !assetFolders.has(asset[0]) || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(asset[1])) return new Response("Not found", { status: 404 });
  try {
    const root = join(process.cwd(), "node_modules/pdfjs-dist");
    const bytes = await readFile(join(root, asset[0], asset[1]));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": asset[1].endsWith(".wasm") ? "application/wasm" : asset[1].endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream",
      "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 });
    return new Response("PDF viewer assets are unavailable.", { status: 503 });
  }
}
