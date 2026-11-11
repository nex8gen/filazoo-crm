import { defaultMailboxForType, defaultViewerMailbox, type NormalizedMailboxRecord } from "./mailbox-utils.ts";

type FlowSenderMailbox = Pick<NormalizedMailboxRecord, "id" | "userId" | "type" | "isDefault" | "isActive">;

/** The default follows the owner; shared senders require a team choice or ID. */
export function resolveFlowSender<T extends FlowSenderMailbox>(mailboxes: T[], ownerId: string, choice: unknown): T | null {
  const available = mailboxes.filter((mailbox) => mailbox.type === "workspace" || mailbox.userId === ownerId);
  if (choice === "owner") return defaultMailboxForType(available, "personal");
  if (choice === "workspace") return defaultMailboxForType(available, "workspace");
  if (choice === "default" || choice === undefined || choice === null) return defaultViewerMailbox(available);
  return available.find((mailbox) => mailbox.id === choice) ?? null;
}

export type FlowMailboxOption = Pick<NormalizedMailboxRecord, "id" | "userId" | "type" | "email" | "isDefault" | "isActive"> & {
  sendConfigured: boolean;
};

// Only public sender details cross the server/client boundary.
export function flowMailboxOptions(mailboxes: NormalizedMailboxRecord[]): FlowMailboxOption[] {
  return mailboxes.map(({ id, userId, type, email, isDefault, isActive, smtpHost, smtpUsername, smtpPassword }) => ({
    id, userId, type, email, isDefault, isActive,
    sendConfigured: Boolean(smtpHost && smtpUsername && smtpPassword),
  }));
}

export function flowSenderOptions(mailboxes: FlowMailboxOption[], ownerId: string) {
  const available = mailboxes.filter((mailbox) => mailbox.type === "workspace" || mailbox.userId === ownerId);
  const label = (mailbox: FlowMailboxOption) => `${mailbox.type === "personal" ? "Personal email" : "Team email"} · ${mailbox.email}${!mailbox.isActive ? " (stopped)" : !mailbox.sendConfigured ? " (setup required)" : ""}`;
  const defaultOption = (id: string, type: FlowMailboxOption["type"]) => {
    const mailbox = defaultMailboxForType(available, type);
    return { id, label: mailbox ? `${label(mailbox)} (default)` : `${type === "personal" ? "Personal email" : "Team email"} · No default connected`, disabled: !mailbox?.isActive || !mailbox.sendConfigured };
  };
  const preferred = resolveFlowSender(available, ownerId, "default");
  return [
    { id: "default", label: preferred ? `My default email · ${preferred.email} (${preferred.type === "personal" ? "personal" : "team"})` : "My default email · No email connected", disabled: !preferred?.isActive || !preferred.sendConfigured },
    defaultOption("owner", "personal"),
    defaultOption("workspace", "workspace"),
    { id: "assigned_owner", label: "Assigned salesperson · Personal mailbox", disabled: false },
    ...available.map((mailbox) => ({ id: mailbox.id, label: label(mailbox), disabled: !mailbox.isActive || !mailbox.sendConfigured })),
  ];
}
