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

export function referenceHeaderIds(value: string[] | string | null | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.flatMap((entry) => entry.match(/<[^<>\s]+>/g) ?? []).map((entry) => entry.trim()))];
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
  const references = referenceHeaderIds(email.references);
  const messageId = email.messageId?.trim().match(/<[^<>\s]+>/)?.[0];
  if (messageId && !references.includes(messageId)) references.push(messageId);
  return references.length > 100 ? [references[0], ...references.slice(-99)] : references;
}

export function groupEmailsByThread<T extends EmailThreadMetadata>(emails: T[]) {
  // A reply may reference only its immediate parent, or carry an older CRM
  // thread key. Resolve all header links before grouping, regardless of order.
  const parents = new Map<string, string>();
  function root(key: string): string {
    const parent = parents.get(key);
    if (!parent || parent === key) return key;
    const resolved = root(parent);
    parents.set(key, resolved);
    return resolved;
  }
  function link(left: string, right: string) {
    const a = root(left), b = root(right);
    if (a !== b) parents.set(b, a);
  }
  for (const email of emails) {
    const key = threadKeyForEmail(email);
    for (const id of [normalizeMessageId(email.messageId), normalizeMessageId(email.inReplyTo), ...normalizeReferences(email.references)]) {
      if (id) link(key, `message:${id}`);
    }
  }
  const grouped = new Map<string, T[]>();
  for (const email of emails) {
    const key = root(threadKeyForEmail(email));
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
    const originalKey = [...grouped].find(([, messages]) => messages.includes(email))?.[0];
    const parentKey = [...grouped].find(([, messages]) => messages.includes(parent))?.[0];
    if (!originalKey || !parentKey || originalKey === parentKey) continue;
    const originalGroup = grouped.get(originalKey) ?? [];
    grouped.delete(originalKey);
    grouped.set(parentKey, [...(grouped.get(parentKey) ?? []), ...originalGroup]);
  }

  return grouped;
}

export function replyTarget<T extends EmailThreadMetadata & { direction: "inbound" | "outbound"; contact: string; replyTo?: string | null; timestamp: string }>(messages: T[]) {
  const ordered = [...messages].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const parent = ordered.find((message) => message.direction === "inbound") ?? ordered[0];
  return parent ? { parent, recipient: (parent.direction === "inbound" ? parent.replyTo || parent.contact : parent.contact).trim() } : null;
}
