import type { NormalizedMailboxRecord } from "./mailbox-utils.ts";
import { mailboxAppId, type AppConnectionSummary, type AppConnectionStatus } from "./app-connection-status.ts";

export type EmailConnectionScope = "personal" | "workspace";
export type EmailConnectionsView = "apps" | "personal" | "team";
export type EmailConnectionAccount = {
  id: string; email: string; name: string; scope: EmailConnectionScope; providerId: string | null;
  isDefault: boolean; isActive: boolean; sendConfigured: boolean; inboxConfigured: boolean; status: AppConnectionStatus;
};
export type EmailConnectionsOverview = { accounts: EmailConnectionAccount[]; error: string | null };

export function emailConnectionAccounts(mailboxes: NormalizedMailboxRecord[], viewerId: string): EmailConnectionAccount[] {
  return mailboxes.filter(mailbox => mailbox.type === "workspace" || mailbox.userId === viewerId).map(mailbox => {
    const sendConfigured = Boolean(mailbox.isActive && mailbox.smtpHost && mailbox.smtpUsername && mailbox.smtpPassword);
    const inboxConfigured = Boolean(mailbox.isActive && mailbox.imapHost && mailbox.imapUsername && mailbox.imapPassword);
    return {
      id: mailbox.id, email: mailbox.email, name: mailbox.displayName || mailbox.email, scope: mailbox.type,
      providerId: mailboxAppId({ smtp_host: mailbox.smtpHost, imap_host: mailbox.imapHost, provider: mailbox.provider }),
      isDefault: mailbox.isDefault, isActive: mailbox.isActive, sendConfigured, inboxConfigured,
      status: !mailbox.isActive ? "paused" : sendConfigured && inboxConfigured ? "connected" : "configured",
    };
  });
}

export function emailProviderSummary(overview: EmailConnectionsOverview, providerId: string): AppConnectionSummary {
  if (overview.error) return { status: "unavailable", message: overview.error };
  const accounts = overview.accounts.filter(account => account.providerId === providerId);
  const active = accounts.filter(account => account.status === "connected");
  return {
    status: active.length ? "connected" : accounts.some(account => account.status === "paused") ? "paused" : accounts.length ? "configured" : "not_connected",
    accountCount: accounts.length,
    personalCount: accounts.filter(account => account.scope === "personal").length,
    teamCount: accounts.filter(account => account.scope === "workspace").length,
    message: accounts.length ? "Connection status reflects saved settings. Personal accounts stay private; team accounts follow workspace access rules." : undefined,
  };
}

export function emailProviderHref(providerId: string, scope: EmailConnectionScope) {
  return `/settings/apps/${encodeURIComponent(providerId)}?scope=${scope === "workspace" ? "team" : "personal"}`;
}
