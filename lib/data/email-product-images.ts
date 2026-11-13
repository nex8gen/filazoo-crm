import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { privateProductImagePattern, PRODUCT_IMAGE_BUCKET } from "../product-images.ts";
import { inlinePrivateEmailImages } from "../email-products.ts";
import type { EmailDesign } from "../email-design.ts";

export async function embedPrivateProductImages(design: EmailDesign, viewerId: string) {
  return inlinePrivateEmailImages(design, async src => {
    const privateImage = privateProductImagePattern.exec(src);
    let input: Buffer;
    if (privateImage) {
      if (privateImage[1] !== viewerId) throw new Error("Choose product images from your own account.");
      const { data, error } = await createSupabaseAdmin().storage.from(PRODUCT_IMAGE_BUCKET).download(`${viewerId}/${privateImage[2]}`);
      if (error || !data) throw new Error("A selected product image is no longer available. Replace it before sending.");
      input = Buffer.from(await data.arrayBuffer());
    } else {
      const target = path.resolve(process.cwd(), "public", src.replace(/^\//, ""));
      if (!target.startsWith(path.resolve(process.cwd(), "public") + path.sep)) throw new Error("Invalid product image path.");
      input = await readFile(target);
    }
    if (input.subarray(0, 3).toString() === "GIF") {
      if (input.length > 750_000) throw new Error("Animated product images must be up to 750 KB. Choose a smaller GIF.");
      return `data:image/gif;base64,${input.toString("base64")}`;
    }
    const image = await sharp(input, { limitInputPixels: 40_000_000 }).resize(600, 600, { fit: "inside", withoutEnlargement: true }).png({ palette: true, quality: 85 }).toBuffer();
    return `data:image/png;base64,${image.toString("base64")}`;
  });
}
