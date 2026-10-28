import type { MailboxRecordInput } from "./mailbox-utils.ts";
import { neteaseProfileForHosts } from "./netease-mail.ts";

export type AppConnectionStatus = "connected" | "not_connected" | "configured" | "paused" | "unavailable" | "planned";
export type AppConnectionSummary = { status: AppConnectionStatus; accountCount?: number; personalCount?: number; teamCount?: number; message?: string };

export function connectionStatusLabel(status: AppConnectionStatus) {
  return { connected: "Connected", not_connected: "Not connected", configured: "Setup needed", paused: "Paused", unavailable: "Status unavailable", planned: "Coming soon" }[status];
}

export function mailboxAppId(mailbox: Pick<MailboxRecordInput, "smtp_host" | "imap_host" | "provider">) {
  const smtp = mailbox.smtp_host?.toLowerCase().trim();
  const imap = mailbox.imap_host?.toLowerCase().trim();
  if (smtp === "smtp.gmail.com" && imap === "imap.gmail.com") return "gmail";
  if (neteaseProfileForHosts(smtp, imap)) return "netease-mail";
  if (["smtp.office365.com", "smtp-mail.outlook.com"].includes(smtp ?? "") && ["outlook.office365.com", "imap-mail.outlook.com"].includes(imap ?? "")) return "outlook";
  return null;
}

export function personalMailboxSummary(rows: MailboxRecordInput[], userId: string, appId: string): AppConnectionSummary {
  const accounts = rows.filter(row => row.type === "personal" && row.user_id === userId && mailboxAppId(row) === appId);
  const active = accounts.filter(row => row.is_active !== false && row.email && row.smtp_host && row.smtp_username && row.smtp_password && row.imap_host && row.imap_username && row.imap_password);
  if (active.length) return { status: "connected", accountCount: active.length, message: "Saved accounts are enabled for sending and receiving. This is not a live provider health check." };
  if (accounts.some(row => row.is_active === false)) return { status: "paused", accountCount: accounts.length };
  return { status: accounts.length ? "configured" : "not_connected", accountCount: accounts.length };
}
