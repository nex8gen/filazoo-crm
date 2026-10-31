"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth";
import { syncErpInventory } from "@/lib/data/inventory";
import { LingxingError } from "@/lib/lingxing";

export async function syncInventory() {
  await requireWorkspaceMember(["admin", "operator"]);
  try {
    const result = await syncErpInventory();
    revalidatePath("/products");
    return { ok: true as const, ...result };
  } catch (error) {
    return { ok: false as const, error: error instanceof LingxingError ? error.message : "Unable to sync ERP stock. Check the inventory migration and server configuration." };
  }
}

