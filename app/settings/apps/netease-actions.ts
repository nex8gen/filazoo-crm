"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyMailboxConnections } from "@/lib/mailbox-connection";
import { mailboxAppId } from "@/lib/app-connection-status";
import { neteaseServerProfiles } from "@/lib/netease-mail";
import type { SettingsActionState } from "../actions";

const schema = z.object({
  mailboxScope: z.enum(["personal", "workspace"]),
  mailboxId: z.union([z.literal(""), z.string().uuid()]),
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().max(80),
  clientPassword: z.string().max(255),
  serverProfile: z.enum(["standard", "hangzhou", "overseas"]),
  smtpPort: z.coerce.number().refine(port => port === 465 || port === 994, "Choose an encrypted SMTP port: 994 or 465."),
});

export async function saveNeteaseConnection(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember();
  const fields = ["mailboxScope", "mailboxId", "email", "displayName", "clientPassword", "serverProfile", "smtpPort"];
  const parsed = schema.safeParse(Object.fromEntries(fields.map(key => [key, formData.get(key) ?? (key === "mailboxScope" ? "personal" : "")])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check your NetEase connection settings." };
  const values = parsed.data;
  if (values.mailboxScope === "workspace" && viewer.role !== "admin") return { error: "Only an administrator can manage team email connections." };
  const server = neteaseServerProfiles[values.serverProfile];
  const admin = createSupabaseAdmin();
  try {
    let lookup = admin.from("workspace_mailboxes")
      .select("id,email,smtp_host,imap_host,provider,smtp_password,imap_password,is_active")
      .eq("id", values.mailboxId).eq("type", values.mailboxScope);
    if (values.mailboxScope === "personal") lookup = lookup.eq("user_id", viewer.id);
    const existing = values.mailboxId ? await lookup.maybeSingle() : { data: null, error: null };
    if (existing.error) return { error: "Saved connection could not be loaded. Refresh and try again." };
    if (values.mailboxId && (!existing.data || mailboxAppId(existing.data) !== "netease-mail")) return { error: "NetEase connection not found or access denied." };
    if (existing.data && existing.data.email.toLowerCase() !== values.email) return { error: "Add a separate connection to use a different NetEase address." };
    const smtpPassword = values.clientPassword || existing.data?.smtp_password || "";
    const imapPassword = values.clientPassword || existing.data?.imap_password || "";
    if (!smtpPassword || !imapPassword) return { error: "Enter the client authorization password from your NetEase email settings." };
    // Only fixed NetEase endpoints can receive the credentials, including when a request is forged.
    await verifyMailboxConnections({ email: values.email, smtpHost: server.smtpHost, smtpPort: values.smtpPort, smtpUsername: values.email, smtpPassword,
      imapHost: server.imapHost, imapPort: 993, imapUsername: values.email, imapPassword });
    const record = {
      email: values.email, user_id: values.mailboxScope === "personal" ? viewer.id : null, type: values.mailboxScope, display_name: values.displayName || "Lingxi Mail", provider: "other",
      smtp_host: server.smtpHost, smtp_port: values.smtpPort, smtp_username: values.email, smtp_password: smtpPassword,
      imap_host: server.imapHost, imap_port: 993, imap_username: values.email, imap_password: imapPassword,
      updated_at: new Date().toISOString(),
    };
    let write = existing.data
      ? admin.from("workspace_mailboxes").update(record).eq("id", values.mailboxId).eq("type", values.mailboxScope)
      : admin.from("workspace_mailboxes").insert({ ...record, is_default: false, is_active: true });
    if (existing.data && values.mailboxScope === "personal") write = write.eq("user_id", viewer.id);
    const result = await write.select("id").maybeSingle();
    if (result.error?.code === "23505") return { error: "This address is already saved. Update its existing connection instead of adding it again." };
    if (result.error || !result.data) return { error: "Lingxi Mail could not be saved. Your other connections were kept." };
    revalidatePath("/settings", "layout");
    revalidatePath("/emails");
    return { success: existing.data?.is_active === false ? "Lingxi credentials verified and updated. This account is still paused." : "Lingxi Mail connected. Sending and receiving authentication passed." };
  } catch {
    return { error: "NetEase could not authenticate. Check your client authorization password, IMAP/SMTP access, and the server profile shown in NetEase settings. No connection was changed." };
  }
}
