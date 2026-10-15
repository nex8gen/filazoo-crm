import { requireWorkspaceMember } from "../auth.ts";
import { normalizeMailboxRows, type NormalizedMailboxRecord } from "../mailbox-utils.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

export type MailboxType = "workspace" | "personal";

export type WorkspaceMailboxRecord = NormalizedMailboxRecord;

export function mailboxHasSmtp(mailbox: WorkspaceMailboxRecord | null | undefined) {
  return Boolean(mailbox?.email && mailbox.smtpHost && mailbox.smtpUsername && mailbox.smtpPassword);
}

export function mailboxHasImap(mailbox: WorkspaceMailboxRecord | null | undefined) {
  return Boolean(mailbox?.email && mailbox.imapHost && mailbox.imapUsername && mailbox.imapPassword);
}

function getEnvironmentMailbox(): WorkspaceMailboxRecord | null {
  const email = process.env.OUTREACH_FROM_EMAIL?.trim().toLowerCase();
  if (!email) return null;

  return {
    id: "environment-mailbox",
    userId: null,
    type: "workspace",
    email,
    displayName: "Environment mailbox",
    isDefault: true,
    provider: "smtp",
    notes: "Configured from server environment variables",
    smtpHost: process.env.SMTP_HOST?.trim() || null,
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUsername: process.env.SMTP_USER?.trim() || null,
    smtpPassword: process.env.SMTP_PASSWORD || null,
    imapHost: process.env.IMAP_HOST?.trim() || null,
    imapPort: Number(process.env.IMAP_PORT || 993),
    imapUsername: process.env.IMAP_USER?.trim() || null,
    imapPassword: process.env.IMAP_PASSWORD || null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

export async function listMailboxes(): Promise<WorkspaceMailboxRecord[]> {
  try {
    const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("workspace_mailboxes")
      .select("id,user_id,type,email,display_name,is_default,provider,notes,smtp_host,smtp_port,smtp_username,smtp_password,imap_host,imap_port,imap_username,imap_password,created_at,updated_at")
      .or(`user_id.eq.${viewer.id},type.eq.workspace`)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Unable to load mailbox settings:", error.message);
      return [];
    }

    return normalizeMailboxRows(data ?? []);
  } catch (error) {
    console.warn("Mailbox data unavailable, keeping settings page functional:", error);
    return [];
  }
}

export async function getDefaultWorkspaceMailbox(): Promise<WorkspaceMailboxRecord | null> {
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("workspace_mailboxes")
      .select("id,user_id,type,email,display_name,is_default,provider,notes,smtp_host,smtp_port,smtp_username,smtp_password,imap_host,imap_port,imap_username,imap_password,created_at,updated_at")
      .eq("type", "workspace")
      .eq("is_default", true)
      .maybeSingle();

    if (error) {
      console.warn("Unable to load the default workspace mailbox:", error.message);
      return null;
    }

    return data ? normalizeMailboxRows([data])[0] ?? null : null;
  } catch (error) {
    console.warn("Workspace mailbox unavailable:", error);
    return null;
  }
}

export async function getUserMailbox(viewerId: string): Promise<WorkspaceMailboxRecord | null> {
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("workspace_mailboxes")
      .select("id,user_id,type,email,display_name,is_default,provider,notes,smtp_host,smtp_port,smtp_username,smtp_password,imap_host,imap_port,imap_username,imap_password,created_at,updated_at")
      .eq("user_id", viewerId)
      .eq("type", "personal")
      .eq("is_default", true)
      .maybeSingle();

    if (error) {
      console.warn("Unable to load the personal mailbox:", error.message);
      return null;
    }

    return data ? normalizeMailboxRows([data])[0] ?? null : null;
  } catch (error) {
    console.warn("Personal mailbox unavailable:", error);
    return null;
  }
}

export async function getEffectiveMailbox(viewerId?: string | null): Promise<WorkspaceMailboxRecord | null> {
  const [personalMailbox, workspaceMailbox] = await Promise.all([
    viewerId ? getUserMailbox(viewerId) : Promise.resolve(null),
    getDefaultWorkspaceMailbox(),
  ]);

  return personalMailbox ?? workspaceMailbox ?? getEnvironmentMailbox();
}
