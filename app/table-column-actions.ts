"use server";

import { requireWorkspaceMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { tableColumnInputSchema, tableColumnMetadataKey } from "@/lib/table-column-preferences";

export async function saveTableColumns(input: unknown): Promise<{ error?: string }> {
  await requireWorkspaceMember();
  const parsed = tableColumnInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Check your column choices." };
  try {
    const client = await createClient();
    const { error } = await client.auth.updateUser({
      data: { [tableColumnMetadataKey(parsed.data.tableId)]: parsed.data.visibility },
    });
    if (error) return { error: "Unable to save column choices. Please try again." };
    return {};
  } catch {
    return { error: "Unable to save column choices. Please try again." };
  }
}
