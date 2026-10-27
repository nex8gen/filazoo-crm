export type MailboxRecordInput = {
  id?: string | null;
  user_id?: string | null;
  type?: string | null;
  email?: string | null;
  display_name?: string | null;
  is_default?: boolean | number | string | null;
  is_active?: boolean | null;
  provider?: string | null;
  notes?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | string | null;
  smtp_username?: string | null;
  smtp_password?: string | null;
  imap_host?: string | null;
  imap_port?: number | string | null;
  imap_username?: string | null;
  imap_password?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type NormalizedMailboxRecord = {
  id: string;
  userId: string | null;
  type: "workspace" | "personal";
  email: string;
  displayName: string | null;
  isDefault: boolean;
  isActive: boolean;
  provider: string | null;
  notes: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapUsername: string | null;
  imapPassword: string | null;
  createdAt: string;
  updatedAt: string;
};

export function normalizeMailboxRow(row: MailboxRecordInput | null | undefined): NormalizedMailboxRecord | null {
  if (!row || typeof row !== "object") return null;

  const type = row.type === "personal" ? "personal" : "workspace";
  const email = typeof row.email === "string" && row.email.trim() ? row.email.trim().toLowerCase() : "";
  if (!email) return null;

  const parsePort = (value: number | string | null | undefined) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    id: typeof row.id === "string" && row.id ? row.id : email,
    userId: typeof row.user_id === "string" && row.user_id ? row.user_id : null,
    type,
    email,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    isDefault: Boolean(row.is_default),
    isActive: row.is_active !== false,
    provider: typeof row.provider === "string" ? row.provider : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    smtpHost: typeof row.smtp_host === "string" ? row.smtp_host : null,
    smtpPort: parsePort(row.smtp_port),
    smtpUsername: typeof row.smtp_username === "string" ? row.smtp_username : null,
    smtpPassword: typeof row.smtp_password === "string" ? row.smtp_password : null,
    imapHost: typeof row.imap_host === "string" ? row.imap_host : null,
    imapPort: parsePort(row.imap_port),
    imapUsername: typeof row.imap_username === "string" ? row.imap_username : null,
    imapPassword: typeof row.imap_password === "string" ? row.imap_password : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date(0).toISOString(),
  };
}

export function normalizeMailboxRows(rows: MailboxRecordInput[] | null | undefined): NormalizedMailboxRecord[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeMailboxRow).filter((row): row is NormalizedMailboxRecord => row !== null);
}

export type MailboxOption = {
  id: string;
  email: string;
  type: "workspace" | "personal";
  sendConfigured: boolean;
  inboxConfigured: boolean;
};

/** Personal mailbox access is always limited to its owner, including admins. */
export function viewerMailboxes(mailboxes: NormalizedMailboxRecord[], viewerId: string) {
  return mailboxes.filter((mailbox) => mailbox.type === "workspace" || mailbox.userId === viewerId);
}

export function defaultViewerMailbox(mailboxes: NormalizedMailboxRecord[]) {
  // A stopped default stays selected; never silently send through another account.
  return mailboxes.find((mailbox) => mailbox.type === "personal" && mailbox.isDefault)
    ?? mailboxes.find((mailbox) => mailbox.type === "personal" && mailbox.isActive)
    ?? mailboxes.find((mailbox) => mailbox.type === "workspace" && mailbox.isDefault)
    ?? mailboxes.find((mailbox) => mailbox.type === "workspace" && mailbox.isActive)
    ?? null;
}
