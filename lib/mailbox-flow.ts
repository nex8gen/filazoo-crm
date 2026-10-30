import { ImapFlow, type MessageStructureObject } from "imapflow";
import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import { mailboxTextParts, parseMailboxHeader, type ImapMailbox, type MimePart, type ReceiveOptions } from "./mailbox-imap.ts";
import { selectMailboxUids } from "./mailbox-sync.ts";
import { providerFolderKind } from "./email-provider.ts";
import type { InboxEmailItem } from "./email-inbox.ts";

export type MailboxFlowScope = { prefix: string; timeoutMs: number };
type Entry = { client: ImapFlow; ready: Promise<void> };
const pool = new Map<string, Entry>();

async function bounded<T>(client: ImapFlow, operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error("Mailbox operation timed out. The background worker will retry.")); client.close(); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function withClient<T>(mailbox: ImapMailbox, scope: MailboxFlowScope, folder: string | null, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (!mailbox.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) throw new Error("Mailbox IMAP settings are incomplete.");
  const key = scope.prefix + createHash("sha256").update(JSON.stringify(mailbox)).digest("hex");
  let entry = pool.get(key);
  if (!entry) {
    const client = new ImapFlow({ host: mailbox.imapHost, port: mailbox.imapPort || 993, secure: true,
      auth: { user: mailbox.imapUsername, pass: mailbox.imapPassword }, logger: false,
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000, maxIdleTime: 30_000,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" } });
    const current: Entry = { client, ready: Promise.resolve() };
    const invalidate = () => { if (pool.get(key) === current) pool.delete(key); };
    // Keep an error listener for the entire connection lifetime, including IDLE/close.
    client.on("error", () => { invalidate(); client.close(); });
    client.on("close", invalidate);
    pool.set(key, current);
    current.ready = bounded(client, client.connect(), scope.timeoutMs).catch((error) => { invalidate(); client.close(); throw error; });
    entry = current;
  }
  const { client } = entry;
  try {
    await entry.ready;
    return await bounded(client, (async () => {
      const lock = folder ? await client.getMailboxLock(folder, { readOnly: true, acquireTimeout: scope.timeoutMs }) : null;
      try { return await run(client); } finally { lock?.release(); }
    })(), scope.timeoutMs);
  } catch (error) { if (pool.get(key) === entry) pool.delete(key); client.close(); throw error; }
}

export function closeMailboxFlowScope(prefix: string) {
  for (const [key, entry] of pool) if (key.startsWith(prefix)) { pool.delete(key); entry.client.close(); }
}

export function mailboxFlowMimeParts(structure?: MessageStructureObject): MimePart[] {
  if (!structure) return [];
  const [type, subtype] = structure.type.toLowerCase().split("/");
  if (type === "multipart") return (structure.childNodes || []).flatMap(mailboxFlowMimeParts);
  return [{ partID: structure.part || "1", type, subtype: subtype || "octet-stream", id: structure.id, location: structure.location, size: structure.size,
    params: structure.parameters, disposition: structure.disposition ? { type: structure.disposition, params: structure.dispositionParameters } : null }];
}

export async function receiveMailboxFlow(mailbox: ImapMailbox, options: ReceiveOptions, scope: MailboxFlowScope): Promise<InboxEmailItem[]> {
  const { limit = 100, folder = "INBOX", cursor, uids, uidValidity, onMailbox, onBatch, headersOnly = true, includePreview = true } = options;
  return withClient(mailbox, scope, folder, async (client) => {
    const box = client.mailbox;
    if (!box) throw new Error("Mailbox could not be opened.");
    const validity = Number(box.uidValidity);
    if (uidValidity !== undefined && uidValidity !== validity) throw new Error("Mailbox identifiers changed. Refresh the inbox.");
    const incremental = cursor?.uidValidity === validity;
    const beforeUid = incremental ? options.beforeUid : undefined;
    const startUid = incremental && !beforeUid ? cursor.lastUid + 1 : 0;
    const found = uids || (beforeUid === 1 ? [] : await client.search(beforeUid ? { uid: `1:${beforeUid - 1}` } : startUid ? { uid: `${startUid}:*` } : { all: true }, { uid: true }));
    const available = Array.isArray(found) ? found : [];
    const ids = selectMailboxUids(available, limit, startUid);
    if (!ids.length) {
      onMailbox?.({ uidValidity: validity, lastUid: incremental ? cursor.lastUid : 0 });
      onBatch?.({ received: 0, hasMore: false, totalMessages: box.exists });
      return [];
    }
    options.onProgress?.(`Fetching ${ids.length} message headers`);
    const headers = await client.fetchAll(ids, { headers: true, bodyStructure: true, flags: true, internalDate: true }, { uid: true });
    if (headers.length !== ids.length || headers.some((message) => !message.headers)) throw new Error("Mailbox changed during sync. Missing headers will be retried.");
    const structures = new Map(headers.map((message) => [message.uid, mailboxFlowMimeParts(message.bodyStructure)]));
    const groups = new Map<string, number[]>();
    if (!headersOnly || includePreview) for (const message of headers) {
      const textParts = mailboxTextParts(structures.get(message.uid));
      for (const part of headersOnly ? textParts.slice(0, 1) : textParts) groups.set(part.partID, [...groups.get(part.partID) || [], message.uid]);
    }
    const bodies = new Map<number, Array<Awaited<ReturnType<typeof simpleParser>>>>();
    for (const [part, members] of groups) {
      // Preview only the first 16 KB, including for large text parts; never fetch files.
      const content = await client.fetchAll(members, { bodyParts: [headersOnly ? { key: part, start: 0, maxLength: 16_384 } : part, `${part}.MIME`] }, { uid: true, binary: false });
      for (const message of content) {
        const pieces = new Map([...message.bodyParts || []].map(([key, value]) => [key.toUpperCase(), value]));
        const header = headers.find((item) => item.uid === message.uid);
        // Some providers omit 1.MIME for a single-part message. Its original
        // message headers already contain the exact charset/transfer encoding.
        const rootText = header?.bodyStructure?.type.toLowerCase().startsWith("text/") && part === "1";
        const body = pieces.get(part.toUpperCase()), mime = pieces.get(`${part}.MIME`.toUpperCase()) || (rootText ? header?.headers : undefined);
        if (!body || !mime) throw new Error("Provider omitted a preview part. It will be retried.");
        const separator = mime.subarray(-4).equals(Buffer.from("\r\n\r\n")) ? "" : mime.subarray(-2).equals(Buffer.from("\r\n")) ? "\r\n" : "\r\n\r\n";
        const parsed = await simpleParser(Buffer.concat([mime, Buffer.from(separator), body]), { keepCidLinks: true });
        bodies.set(message.uid, [...bodies.get(message.uid) || [], parsed]);
      }
    }
    const messages: InboxEmailItem[] = [];
    for (const message of headers) messages.push(await parseMailboxHeader(mailbox, { headers: message.headers!, uid: message.uid, uidValidity: validity,
      flags: [...message.flags || []], date: message.internalDate ? new Date(message.internalDate) : undefined, structure: structures.get(message.uid) }, bodies.get(message.uid) || [], options));
    onMailbox?.({ uidValidity: validity, lastUid: Math.max(...ids) });
    onBatch?.({ received: ids.length, hasMore: available.filter((uid) => uid >= startUid).length > ids.length, totalMessages: box.exists });
    return messages.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  });
}

export async function listMailboxFlowFolders(mailbox: ImapMailbox, scope: MailboxFlowScope) {
  return withClient(mailbox, scope, null, async (client) => (await client.list({ listOnly: true }))
    .filter((folder) => ![...folder.flags].some((flag) => flag.toLowerCase() === "\\noselect"))
    .map((folder) => ({ path: folder.path, name: folder.name, kind: providerFolderKind(folder.path, [...folder.flags, ...folder.specialUse ? [folder.specialUse] : []]) })));
}

export async function reconcileMailboxFlow(mailbox: ImapMailbox, messages: InboxEmailItem[], folder: string, scope: MailboxFlowScope) {
  if (!messages.length) return messages;
  return withClient(mailbox, scope, folder, async (client) => {
    if (!client.mailbox || messages.some((message) => message.uidValidity !== Number(client.mailbox && client.mailbox.uidValidity))) return messages;
    const found = await client.search({ all: true }, { uid: true });
    const available = new Set(Array.isArray(found) ? found : []);
    const ids = messages.flatMap((message) => message.uid && available.has(message.uid) ? [message.uid] : []);
    const flags = new Map<number, Set<string>>();
    for (let index = 0; index < ids.length; index += 500) for (const message of await client.fetchAll(ids.slice(index, index + 500), { flags: true }, { uid: true })) flags.set(message.uid, message.flags || new Set());
    return messages.map((message) => ({ ...message, providerRemoved: !available.has(message.uid!), read: flags.get(message.uid!)?.has("\\Seen") ?? message.read, starred: flags.get(message.uid!)?.has("\\Flagged") ?? message.starred }));
  });
}
