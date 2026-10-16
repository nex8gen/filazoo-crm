export type EmailThreadMetadata = {
  id: string;
  threadId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
};

export function normalizeMessageId(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const bracketed = trimmed.match(/<[^<>\s]+>/)?.[0];
  return (bracketed || trimmed).toLowerCase();
}

export function normalizeReferences(value: string[] | string | null | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((entry) => entry.match(/<[^<>\s]+>/g) ?? [entry])
    .map(normalizeMessageId)
    .filter((entry): entry is string => Boolean(entry));
}

export function threadKeyForEmail(email: EmailThreadMetadata) {
  if (email.threadId?.trim()) return email.threadId.trim();
  const references = normalizeReferences(email.references);
  const rootMessageId = references[0]
    || normalizeMessageId(email.inReplyTo)
    || normalizeMessageId(email.messageId);
  return rootMessageId ? `message:${rootMessageId}` : `local:${email.id}`;
}

export function replyReferences(email: EmailThreadMetadata) {
  const references = normalizeReferences(email.references);
  const messageId = normalizeMessageId(email.messageId);
  if (messageId && !references.includes(messageId)) references.push(messageId);
  return references;
}

export function groupEmailsByThread<T extends EmailThreadMetadata>(emails: T[]) {
  const grouped = new Map<string, T[]>();
  for (const email of emails) {
    const key = threadKeyForEmail(email);
    grouped.set(key, [...(grouped.get(key) ?? []), email]);
  }
  return grouped;
}

type ConversationEmail = EmailThreadMetadata & {
  direction: "inbound" | "outbound";
  subject: string;
  contact: string;
  timestamp: string;
};

function normalizedSubject(subject: string) {
  return subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim().toLowerCase();
}

export function groupEmailConversations<T extends ConversationEmail>(emails: T[]) {
  const grouped = groupEmailsByThread(emails);

  // Compatibility for replies sent before the CRM stored RFC threading
  // metadata. Only outbound "Re:" messages use this fallback, so unrelated
  // inbound messages with an identical subject remain separate conversations.
  for (const email of emails) {
    const hasReplyMetadata = Boolean(email.threadId || email.inReplyTo || email.references?.length);
    if (email.direction !== "outbound" || hasReplyMetadata || !/^\s*re\s*:/i.test(email.subject)) continue;
    const sentAt = new Date(email.timestamp).getTime();
    const parent = emails
      .filter((candidate) => candidate.direction === "inbound"
        && candidate.contact.trim().toLowerCase() === email.contact.trim().toLowerCase()
        && normalizedSubject(candidate.subject) === normalizedSubject(email.subject)
        && new Date(candidate.timestamp).getTime() <= sentAt
        && sentAt - new Date(candidate.timestamp).getTime() <= 30 * 24 * 60 * 60 * 1000)
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())[0];
    if (!parent) continue;
    const originalKey = threadKeyForEmail(email);
    const parentKey = threadKeyForEmail(parent);
    const originalGroup = grouped.get(originalKey) ?? [];
    grouped.delete(originalKey);
    grouped.set(parentKey, [...(grouped.get(parentKey) ?? []), ...originalGroup]);
  }

  return grouped;
}
