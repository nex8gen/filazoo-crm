"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { readAccountSecurity, readDeviceSessions } from "@/lib/account-security-server";
import { createSupabaseControl } from "@/lib/supabase/control";

const revokeSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("one"), id: z.uuid() }).strict(),
  z.object({ scope: z.enum(["others", "all"]) }).strict(),
]);

export async function loadDeviceSessions() {
  await requireViewer();
  try { return { sessions: await readDeviceSessions() }; }
  catch { return { error: "Unable to load your devices. Please try again." }; }
}

export async function revokeDeviceSessions(input: unknown) {
  await requireViewer();
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid device or session action." };
  try {
    const security = await readAccountSecurity();
    if (security.requiresMfa) return { error: "Complete two-step verification first." };
    const { error } = await createSupabaseControl().rpc("revoke_account_sessions", {
      p_user_id: security.userId, p_session_id: security.sessionId, p_scope: parsed.data.scope,
      p_target_id: parsed.data.scope === "one" ? parsed.data.id : null,
    });
    if (error) return { error: "Unable to end the selected sessions. Refresh and try again." };
    const signedOut = parsed.data.scope === "all" || (parsed.data.scope === "one" && parsed.data.id === security.sessionId);
    if (signedOut) await security.client.auth.signOut({ scope: "local" });
    revalidatePath("/", "layout");
    return { signedOut, success: parsed.data.scope === "others" ? "Other devices have been signed out. This device stays signed in." : "The selected sessions have ended." };
  } catch { return { error: "Unable to end the selected sessions. Please try again." }; }
}
