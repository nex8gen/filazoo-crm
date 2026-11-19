"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { userProductRows } from "@/lib/data/product-personalization";
import { readManualStock } from "@/lib/data/shared-product-inventory";
import { getInventoryState } from "@/lib/data/inventory";
import { applyProductInventory } from "@/lib/product-inventory";
import { crmProduct } from "@/lib/product-utils";
import type { SharedManualStock, StockAdjustment } from "@/lib/types";

const identity = z.object({ productSku: z.string().trim().min(1).max(120), sku: z.string().trim().min(1).max(120) });
const adjustment = identity.extend({ location: z.string().trim().min(1).max(100), quantity: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), revision: z.uuid().nullable(), reason: z.string().trim().min(1).max(300) });

async function savedItem(productSku: string, sku: string, userId: string) {
  const [row] = await userProductRows(userId, [productSku]);
  if (!row) throw new Error("Save the product before updating shared inventory.");
  const product = crmProduct(row);
  const item = sku === productSku ? product : product.variants.find(variant => variant.sku === sku);
  if (!item) throw new Error("Save this variant SKU before updating shared inventory.");
  return product;
}

export async function loadProductStock(input: { productSku: string; sku: string }): Promise<{ stock?: SharedManualStock; history?: StockAdjustment[]; error?: string }> {
  const viewer = await requireWorkspaceMember();
  const parsed = identity.safeParse(input);
  if (!parsed.success) return { error: "Choose a saved product SKU." };
  try {
    await savedItem(parsed.data.productSku, parsed.data.sku, viewer.id);
    const [locations, history] = await Promise.all([
      readManualStock([parsed.data.sku]),
      createSupabaseAdmin().from("product_stock_adjustments").select("id,location,previous_quantity,quantity,reason,actor_name,created_at").eq("workspace_id", viewer.workspaceId).eq("sku", parsed.data.sku).order("created_at", { ascending: false }).limit(30),
    ]);
    if (history.error) return { error: "Unable to load adjustment history." };
    return { stock: { locations, readOnly: viewer.role === "viewer" }, history: history.data ?? [] };
  } catch (error) { return { error: error instanceof Error ? error.message : "Unable to load shared inventory." }; }
}

export async function adjustProductStock(input: z.infer<typeof adjustment>): Promise<{ revision?: string; error?: string }> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = adjustment.safeParse(input);
  if (!parsed.success) return { error: "Enter a location, whole quantity (or leave unknown), and adjustment reason." };
  const value = parsed.data;
  try {
    const product = await savedItem(value.productSku, value.sku, viewer.id);
    const inventory = await getInventoryState();
    if (inventory.status.configurationError) return { error: "Check the inventory connection before changing manual stock." };
    const [connected] = applyProductInventory([product], inventory.snapshots, inventory.skuMap);
    if ((value.sku === product.sku ? connected : connected.variants.find(variant => variant.sku === value.sku))?.stock) return { error: "This SKU is connected. Update stock in the inventory system." };
    const { data, error } = await createSupabaseAdmin().rpc("adjust_product_manual_stock", { p_sku: value.sku, p_location: value.location, p_quantity: value.quantity, p_expected_revision: value.revision, p_reason: value.reason, p_actor_id: viewer.id });
    if (error) return { error: error.code === "40001" ? "A teammate changed this stock. Reload stock before adjusting it." : "The stock adjustment could not be saved." };
    revalidatePath("/products");
    return { revision: String(data) };
  } catch (error) { return { error: error instanceof Error ? error.message : "The stock adjustment could not be saved." }; }
}
