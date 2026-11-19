import { threadKeyForEmail, type EmailThreadMetadata } from "./email-threading.ts";

type LinkedEmail = EmailThreadMetadata & {
  direction: "inbound" | "outbound";
  timestamp: string;
  folder?: string;
  providerKind?: string;
};

/** Provider labels may classify Inbox copies as custom. Open the linked
 * conversation across normal folders instead of hiding it behind that filter. */
export function emailDeepLinkSelection<T extends LinkedEmail>(messages: T[], threadId?: string | null) {
  if (!threadId) return null;
  const matches = messages.filter(message => threadKeyForEmail(message) === threadId || message.id === threadId);
  const latest = (values: T[]) => values.reduce<T | undefined>((selected, message) => !selected || Date.parse(message.timestamp) > Date.parse(selected.timestamp) ? message : selected, undefined);
  const message = latest(matches.filter(message => message.direction === "inbound")) ?? latest(matches);
  if (!message) return null;
  const folder = message.folder === "trash" ? "trash" : message.providerKind === "spam" ? "spam" : "all";
  return { message, folder } as const;
}
