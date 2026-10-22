import { requireWorkspaceMember } from "../auth.ts";
import { normalizeMailboxRows, type NormalizedMailboxRecord } from "../mailbox-utils.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

export type MailboxType = "workspace" | "personal";

export type WorkspaceMailboxRecord = NormalizedMailboxRecord;

export function mailboxHasSmtp(mailbox: WorkspaceMailboxRecord | null | undefined) {
  return Boolean(mailbox?.isActive && mailbox.email && mailbox.smtpHost && mailbox.smtpUsername && mailbox.smtpPassword);
}

export function mailboxHasImap(mailbox: WorkspaceMailboxRecord | null | undefined) {
  return Boolean(mailbox?.isActive && mailbox.email && mailbox.imapHost && mailbox.imapUsername && mailbox.imapPassword);
}

export async function listMailboxes(): Promise<WorkspaceMailboxRecord[]> {
  try {
    const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
    const admin = createSupabaseAdmin();
    let query = admin
      .from("workspace_mailboxes")
      .select("*")
      .order("created_at", { ascending: false });
    if (viewer.role !== "admin") query = query.or(`user_id.eq.${viewer.id},type.eq.workspace`);
    const { data, error } = await query;

    if (error) {
      console.warn("Unable to load mailbox settings:", error.message);
      throw new Error("Unable to load configured mailboxes. Please refresh Settings.");
    }

    return normalizeMailboxRows(data ?? []);
  } catch (error) {
    console.warn("Mailbox data unavailable, keeping settings page functional:", error);
    throw error;
  }
}

export async function getDefaultWorkspaceMailbox(): Promise<WorkspaceMailboxRecord | null> {
  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from("workspace_mailboxes")
      .select("*")
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
      .select("*")
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

  // Keep a stopped default selected so it cannot silently fall back to another sender.
  // Connections removed in Settings must not reappear from environment credentials.
  return personalMailbox ?? workspaceMailbox;
}
