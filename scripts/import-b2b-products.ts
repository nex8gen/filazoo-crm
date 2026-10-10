import { createClient } from "@supabase/supabase-js";
import { b2bProducts } from "../lib/data/b2b-products.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !secret) throw new Error("Supabase server credentials are required.");

const rows = b2bProducts.map((product) => ({
  sku: product.sku,
  name: product.name,
  material: product.material,
  color: product.colors.join(", "),
  diameter: null,
  weight: product.weight === "Not specified" ? null : product.weight,
  price: Number(product.price.replace("$", "")),
  currency: "USD",
  moq: product.moq,
  stock_status: product.stockStatus,
  lead_time: product.leadTime,
  tags: ["b2b", "quotation-2610"],
  description: `EXW price tiers: ${product.priceTiers.map((tier) => `${tier.minimumQuantity}+ pcs ${tier.price}`).join("; ")}. Colors: ${product.colors.join(", ")}.`,
  active: true,
  sheet_updated_at: product.updatedAt,
}));

const supabase = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const { error } = await supabase.from("products").upsert(rows, { onConflict: "sku" });
if (error) throw new Error(`Unable to import B2B products: ${error.message}`);

const { data: imported, error: verificationError } = await supabase.from("products").select("sku").contains("tags", ["quotation-2610"]);
if (verificationError) throw new Error(`Unable to verify B2B products: ${verificationError.message}`);
const expectedSkus = new Set(rows.map((row) => row.sku));
const importedSkus = new Set((imported ?? []).map((row) => row.sku));
if (expectedSkus.size !== importedSkus.size || [...expectedSkus].some((sku) => !importedSkus.has(sku))) {
  throw new Error(`B2B product verification failed: expected ${expectedSkus.size}, found ${importedSkus.size}.`);
}

console.log(`Imported and verified ${rows.length} B2B products.`);
