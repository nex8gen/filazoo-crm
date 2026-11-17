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
  displayName?: string | null;
};

// Only public sender details cross the server/client boundary.
export function flowMailboxOptions(mailboxes: NormalizedMailboxRecord[]): FlowMailboxOption[] {
  return mailboxes.map(({ id, userId, type, email, displayName, isDefault, isActive, smtpHost, smtpUsername, smtpPassword }) => ({
    id, userId, type, email, displayName, isDefault, isActive,
    sendConfigured: Boolean(smtpHost && smtpUsername && smtpPassword),
  }));
}

export function flowSenderOptions(mailboxes: FlowMailboxOption[], ownerId: string, viewerId = ownerId) {
  const available = mailboxes.filter((mailbox) => mailbox.type === "workspace" || mailbox.userId === ownerId && mailbox.userId === viewerId);
  const label = (mailbox: FlowMailboxOption) => `${mailbox.type === "personal" ? "Personal email" : "Team email"} · ${mailbox.email}${!mailbox.isActive ? " (stopped)" : !mailbox.sendConfigured ? " (setup required)" : ""}`;
  // Legacy rules still resolve, but never appear as duplicate account choices.
  return available.map((mailbox) => ({
    id: mailbox.id, label: label(mailbox), disabled: !mailbox.isActive || !mailbox.sendConfigured,
    aliases: (viewerId === ownerId ? ["default", "owner", "workspace"] : ["workspace"]).filter((choice) => resolveFlowSender(available, ownerId, choice)?.id === mailbox.id),
  }));
}

export function selectedFlowSender<T extends { id: string; aliases?: string[] }>(options: T[], value: string): T | undefined {
  return options.find((option) => option.id === value) ?? options.find((option) => option.aliases?.includes(value));
}

/** A viewer's limited inventory cannot resolve another owner's default sender. */
export function visibleFlowSender(mailboxes: FlowMailboxOption[], ownerId: string, viewerId: string, choice: unknown) {
  const selected = selectedFlowSender(flowSenderOptions(mailboxes, ownerId, viewerId), String(choice ?? "default"));
  return mailboxes.find(mailbox => mailbox.id === selected?.id) ?? null;
}
