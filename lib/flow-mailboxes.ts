import type { NormalizedMailboxRecord } from "./mailbox-utils.ts";

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
    const mailbox = available.find((item) => item.type === type && item.isDefault);
    return { id, label: mailbox ? `${label(mailbox)} (default)` : `${type === "personal" ? "Personal email" : "Team email"} · No default connected`, disabled: !mailbox?.isActive || !mailbox.sendConfigured };
  };
  return [
    defaultOption("owner", "personal"),
    defaultOption("default", "workspace"),
    ...available.map((mailbox) => ({ id: mailbox.id, label: label(mailbox), disabled: !mailbox.isActive || !mailbox.sendConfigured })),
  ];
}
