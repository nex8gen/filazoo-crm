"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyMailboxConnections } from "@/lib/mailbox-connection";
import { mailboxAppId } from "@/lib/app-connection-status";
import type { SettingsActionState } from "../actions";

const schema = z.object({
  mailboxScope: z.enum(["personal", "workspace"]),
  mailboxId: z.union([z.literal(""), z.string().uuid()]),
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().max(80),
  appPassword: z.string().transform(value => value.replace(/\s/g, "")).refine(value => !value || value.length === 16, "Enter the 16-character Google app password."),
});

export async function saveGmailConnection(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember();
  const parsed = schema.safeParse(Object.fromEntries(["mailboxScope", "mailboxId", "email", "displayName", "appPassword"].map(key => [key, formData.get(key) ?? (key === "mailboxScope" ? "personal" : "")])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the connection fields." };
  const values = parsed.data;
  if (values.mailboxScope === "workspace" && viewer.role !== "admin") return { error: "Only an administrator can manage team email connections." };
  const admin = createSupabaseAdmin();
  try {
    let lookup = admin.from("workspace_mailboxes")
      .select("id,email,smtp_host,imap_host,provider,smtp_password,imap_password,is_default,is_active")
      .eq("id", values.mailboxId).eq("type", values.mailboxScope);
    if (values.mailboxScope === "personal") lookup = lookup.eq("user_id", viewer.id);
    const existing = values.mailboxId ? await lookup.maybeSingle() : { data: null, error: null };
    if (existing.error) return { error: "Saved connection could not be loaded. Refresh and try again." };
    if (values.mailboxId && (!existing.data || mailboxAppId(existing.data) !== "gmail")) return { error: "Gmail connection not found or access denied." };
    if (existing.data && existing.data.email.toLowerCase() !== values.email) return { error: "Add a separate connection to use a different Gmail address." };
    const smtpPassword = values.appPassword || existing.data?.smtp_password || "";
    const imapPassword = values.appPassword || existing.data?.imap_password || "";
    if (!smtpPassword || !imapPassword) return { error: "Enter your Google app password to connect Gmail." };
    // The provider endpoints are fixed. Never trust a browser-supplied mail host.
    await verifyMailboxConnections({ email: values.email, smtpHost: "smtp.gmail.com", smtpPort: 587, smtpUsername: values.email, smtpPassword,
      imapHost: "imap.gmail.com", imapPort: 993, imapUsername: values.email, imapPassword });
    const record = {
      email: values.email, user_id: values.mailboxScope === "personal" ? viewer.id : null, type: values.mailboxScope, display_name: values.displayName || "Gmail",
      provider: "google", smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_username: values.email, smtp_password: smtpPassword,
      imap_host: "imap.gmail.com", imap_port: 993, imap_username: values.email, imap_password: imapPassword,
      updated_at: new Date().toISOString(),
    };
    // Insert instead of upsert: an existing email must never change owners or replace a shared account.
    let write = existing.data
      ? admin.from("workspace_mailboxes").update(record).eq("id", values.mailboxId).eq("type", values.mailboxScope)
      : admin.from("workspace_mailboxes").insert({ ...record, is_default: false, is_active: true });
    if (existing.data && values.mailboxScope === "personal") write = write.eq("user_id", viewer.id);
    const result = await write.select("id").maybeSingle();
    if (result.error?.code === "23505") return { error: "This address is already saved. Update its existing connection instead of adding it again." };
    if (result.error || !result.data) return { error: "Gmail could not be saved. Your other connections were kept." };
    revalidatePath("/settings", "layout");
    revalidatePath("/email");
    return { success: existing.data?.is_active === false ? "Gmail credentials verified and updated. This account is still paused." : "Gmail connected. Sending and receiving authentication passed." };
  } catch {
    return { error: "Gmail could not authenticate. Check the email address, app password, and whether your Google account allows mail access. No connection was changed." };
  }
}
