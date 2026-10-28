import Imap from "imap";
import { simpleParser } from "mailparser";
import type { InboxEmailItem } from "./email-inbox.ts";
import { referenceHeaderIds, threadKeyForEmail } from "./email-threading.ts";
import { selectMailboxUids, type MailboxCursor } from "./mailbox-sync.ts";
import { createHash } from "node:crypto";

export type ImapMailbox = { email: string | null; imapHost: string | null; imapPort: number | null; imapUsername: string | null; imapPassword: string | null };
export type MimePart = { partID: string; type: string; subtype: string; id?: string; size?: number; params?: Record<string, string>; disposition?: { type?: string; params?: Record<string, string> } | null };

export function mailboxMimeParts(structure: unknown): MimePart[] {
  if (!Array.isArray(structure)) return [];
  return structure.flatMap((part) => {
    if (Array.isArray(part)) return mailboxMimeParts(part);
    if (!part || typeof part !== "object") return [];
    // Do not traverse a forwarded message/rfc822 attachment's own structure.
    return typeof part.partID === "string" ? [part as MimePart] : [];
  });
}

export function mailboxTextParts(structure: unknown) {
  const parts = mailboxMimeParts(structure).filter((part) => part.type.toLowerCase() === "text"
    && ["plain", "html"].includes(part.subtype.toLowerCase())
    && part.disposition?.type?.toLowerCase() !== "attachment"
    && !part.disposition?.params?.filename && !part.params?.name);
  return [parts.find((part) => part.subtype.toLowerCase() === "plain"), parts.find((part) => part.subtype.toLowerCase() === "html")]
    .filter((part): part is MimePart => Boolean(part));
}

type FetchedMessage = { attributes: Imap.ImapMessageAttributes; bodies: Map<string, Buffer> };
function fetchParts(connection: Imap, ids: number[], bodies: string[], struct = false): Promise<FetchedMessage[]> {
  return new Promise((resolve, reject) => {
    const pending: Promise<FetchedMessage>[] = [];
    const fetch = connection.fetch(ids, { bodies, struct, markSeen: false });
    fetch.on("message", (message) => {
      const task = new Promise<FetchedMessage>((done, fail) => {
        let attributes: Imap.ImapMessageAttributes;
        const content = new Map<string, Buffer>();
        const streams: Promise<void>[] = [];
        message.once("attributes", (value) => { attributes = value; });
        message.once("error", fail);
        message.on("body", (stream, info) => {
          const chunks: Buffer[] = [];
          let size = 0;
          streams.push(new Promise<void>((finish, error) => {
            stream.once("error", error);
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > 25_000_000) { error(new Error("Email part exceeds the 25 MB download limit.")); return; }
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            stream.once("end", () => { content.set(info.which.toUpperCase(), Buffer.concat(chunks)); finish(); });
          }));
          void streams.at(-1)!.catch(fail);
        });
        message.once("end", () => {
          void Promise.all(streams).then(() => {
            if (!attributes?.uid) throw new Error("IMAP message did not include a stable UID.");
            done({ attributes, bodies: content });
          }).catch(fail);
        });
      });
      pending.push(task);
      void task.catch(reject);
    });
    fetch.once("error", reject);
    fetch.once("end", () => { void Promise.all(pending).then(resolve, reject); });
  });
}

type ImapSession = { connection: Imap; box: Imap.Box; version: number; checkpointVersion?: number; verifiedUid?: number; verifiedAt?: number };
export function canReuseMailboxCheckpoint(cursor: MailboxCursor | undefined, state: { uidValidity: number; version: number; checkpointVersion?: number; verifiedUid?: number; verifiedAt?: number }, now = Date.now()) {
  return Boolean(cursor && cursor.uidValidity === state.uidValidity && cursor.lastUid === state.verifiedUid
    && state.version === state.checkpointVersion && state.verifiedAt && now - state.verifiedAt < 30000);
}
type PoolEntry = { session: Promise<ImapSession>; tail: Promise<unknown>; expiry?: ReturnType<typeof setTimeout> };
const sessions = new Map<string, PoolEntry>();

export async function closeMailboxSessions() {
  const entries = [...sessions.values()];
  sessions.clear();
  await Promise.all(entries.map(async (entry) => {
    clearTimeout(entry.expiry);
    try { (await entry.session).connection.destroy(); } catch { /* Failed connections are already closed. */ }
  }));
}

function connectImap(mailbox: ImapMailbox, onProgress?: (stage: string) => void): Promise<ImapSession> {
  if (!mailbox.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) throw new Error("Mailbox IMAP settings are incomplete.");
  return new Promise((resolve, reject) => {
    const connection = new Imap({ user: mailbox.imapUsername!, password: mailbox.imapPassword!, host: mailbox.imapHost!, port: mailbox.imapPort ?? 993, tls: true,
      tlsOptions: { rejectUnauthorized: true, servername: mailbox.imapHost!, minVersion: "TLSv1.2" }, authTimeout: 15000, connTimeout: 15000 });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Mailbox connection timed out. Saved messages are still available.")), 90000);
    function finish(error?: Error, result?: ImapSession) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { connection.destroy(); reject(error); } else resolve(result!);
    }
    connection.once("error", finish);
    connection.once("close", () => { if (!settled) finish(new Error("Mailbox connection closed before the download completed.")); });
    connection.once("ready", () => {
      onProgress?.("Authenticated; opening INBOX read-only");
      connection.openBox("INBOX", true, (error, box) => {
        if (error) { finish(error); return; }
        const session: ImapSession = { connection, box, version: 0 };
        connection.on("mail", () => { session.version += 1; });
        connection.on("expunge", () => { session.version += 1; });
        finish(undefined, session);
      });
    });
    connection.connect();
  });
}

async function withImap<T>(mailbox: ImapMailbox, action: (connection: Imap, box: Imap.Box, session: ImapSession) => Promise<T>, onProgress?: (stage: string) => void): Promise<T> {
  // Reuse authenticated sessions on warm servers. Opening a new provider session
  // on every 10-second poll can cost far more than fetching the new messages.
  // Credentials are only included in this in-memory hash, never in DB or logs.
  const key = createHash("sha256").update(JSON.stringify(mailbox)).digest("hex");
  let entry = sessions.get(key);
  if (!entry) {
    const session = connectImap(mailbox, onProgress);
    entry = { session, tail: Promise.resolve() };
    sessions.set(key, entry);
    const current = entry;
    const invalidate = () => {
      if (sessions.get(key) !== current) return;
      sessions.delete(key);
      clearTimeout(current.expiry);
      void current.session.then(({ connection }) => connection.destroy(), () => undefined);
    };
    void session.then(({ connection }) => {
      connection.on("error", invalidate);
      connection.once("close", invalidate);
      connection.once("end", invalidate);
      connection.once("uidvalidity", invalidate);
    }, invalidate);
  } else onProgress?.("Reusing authenticated IMAP session");
  clearTimeout(entry.expiry);
  const current = entry;
  const operation = current.tail.then(async () => {
    const session = await current.session;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectConnection!: (error: Error) => void;
    const connectionFailure = new Promise<never>((_, reject) => { rejectConnection = reject; });
    const closed = () => rejectConnection(new Error("Mailbox connection closed during download. Try again."));
    session.connection.once("error", rejectConnection);
    session.connection.once("close", closed);
    try {
      return await Promise.race([
        action(session.connection, session.box, session),
        connectionFailure,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Mailbox operation timed out. Saved messages are still available.")), 90000); }),
      ]);
    } catch (error) {
      if (sessions.get(key) === current) sessions.delete(key);
      session.connection.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
      session.connection.removeListener("error", rejectConnection);
      session.connection.removeListener("close", closed);
    }
  });
  current.tail = operation.catch(() => undefined);
  try { return await operation; }
  finally {
    // No permanent worker or process-local cache is required for correctness;
    // the database snapshot and UID checkpoint survive cold starts.
    current.expiry = setTimeout(() => {
      if (sessions.get(key) === current) sessions.delete(key);
      void current.session.then(({ connection }) => connection.end(), () => undefined);
    }, 120000);
    current.expiry.unref();
  }
}

export type ReceiveOptions = { limit?: number; cursor?: MailboxCursor; beforeUid?: number; onMailbox?: (cursor: MailboxCursor) => void; onProgress?: (stage: string) => void; headersOnly?: boolean; uids?: number[]; uidValidity?: number };
export async function receiveMailboxMessages(mailbox: ImapMailbox, { limit = 10, cursor, beforeUid, onMailbox, onProgress, headersOnly = true, uids, uidValidity }: ReceiveOptions = {}): Promise<InboxEmailItem[]> {
  onProgress?.("Connecting to IMAP");
  return withImap(mailbox, async (connection, box, session) => {
    if (uidValidity !== undefined && uidValidity !== box.uidvalidity) throw new Error("Mailbox identifiers changed. Refresh the inbox before opening this message.");
    if (!uids && !beforeUid && canReuseMailboxCheckpoint(cursor, { ...session, uidValidity: box.uidvalidity })) {
      onProgress?.("IMAP notifications confirm no new mail");
      onMailbox?.(cursor!);
      return [];
    }
    const versionBeforeSearch = session.version;
    onProgress?.("Searching message UIDs");
    const incremental = cursor?.uidValidity === box.uidvalidity;
    // Older UIDs are meaningful only within the same mailbox epoch.
    if (beforeUid && !incremental) beforeUid = undefined;
    const startUid = incremental && !beforeUid ? cursor.lastUid + 1 : 0;
    const criteria = beforeUid ? [["UID", `1:${Math.max(1, beforeUid - 1)}`]] : startUid ? [["UID", `${startUid}:*`]] : ["ALL"];
    const results = uids ?? (beforeUid === 1 ? [] : await new Promise<number[]>((resolve, reject) => connection.search(criteria, (error, uids) => error ? reject(error) : resolve(uids))));
    const ids = selectMailboxUids(results, limit, startUid);
    if (!ids.length) {
      if (!uids && !beforeUid) {
        session.verifiedAt = Date.now(); session.verifiedUid = incremental ? cursor.lastUid : 0; session.checkpointVersion = versionBeforeSearch;
      }
      onMailbox?.({ uidValidity: box.uidvalidity, lastUid: incremental ? cursor.lastUid : 0 });
      return [];
    }
    // Fetch small headers and MIME structure first. Never download attachments
    // during sync: one large PDF must not block every other incoming message.
    onProgress?.(`Fetching ${ids.length} message headers`);
    const headers = await fetchParts(connection, ids, ["HEADER"], true);
    const groups = new Map<string, number[]>();
    for (const message of headersOnly ? [] : headers) {
      for (const part of mailboxTextParts(message.attributes.struct)) {
        groups.set(part.partID, [...(groups.get(part.partID) ?? []), message.attributes.uid]);
      }
    }
    const content = new Map<number, Array<Awaited<ReturnType<typeof simpleParser>>>>();
    for (const [partID, uids] of groups) {
      onProgress?.(`Fetching text part ${partID} for ${uids.length} messages`);
      const parts = await fetchParts(connection, uids, [partID, `${partID}.MIME`]);
      for (const part of parts) {
        const body = part.bodies.get(partID.toUpperCase());
        const mime = part.bodies.get(`${partID}.MIME`.toUpperCase());
        if (!body || !mime) throw new Error("IMAP server omitted an email body part; sync will retry.");
        const parsed = await simpleParser(Buffer.concat([mime, Buffer.from("\r\n"), body]));
        content.set(part.attributes.uid, [...(content.get(part.attributes.uid) ?? []), parsed]);
      }
    }
    onProgress?.("Parsing message headers and bodies");
    const items: InboxEmailItem[] = [];
    for (const message of headers) {
      const parsed = await simpleParser(message.bodies.get("HEADER") ?? Buffer.alloc(0));
      const bodies = content.get(message.attributes.uid) ?? [];
      const plain = bodies.find((body) => body.text)?.text;
      const html = bodies.find((body) => typeof body.html === "string")?.html;
      const body = headersOnly ? "" : plain || bodies.find((part) => part.text)?.text || "This email has no text body.";
      const from = parsed.from?.value[0];
      const item: InboxEmailItem = {
        id: parsed.messageId ? `imap-${parsed.messageId}` : `imap-${mailbox.email}-${box.uidvalidity}-${message.attributes.uid}`,
        uid: message.attributes.uid, uidValidity: box.uidvalidity, bodyLoaded: !headersOnly,
        from: from?.address, replyTo: parsed.replyTo?.value[0]?.address || null,
        automaticResponse: (parsed.headers.has("auto-submitted") && String(parsed.headers.get("auto-submitted")).toLowerCase() !== "no")
          || /bulk|list|junk/i.test(String(parsed.headers.get("precedence") || "")) || parsed.headers.has("list-id"),
        contact: from?.address || "Unknown sender", contactName: from?.name,
        direction: "inbound", status: "Received", subject: parsed.subject || "(No subject)", company: "Unknown company",
        body, preview: body.replace(/\s+/g, " ").slice(0, 160), html: typeof html === "string" ? html : null,
        messageId: parsed.messageId || null, inReplyTo: parsed.inReplyTo || null, references: referenceHeaderIds(parsed.references),
        timestamp: (parsed.date || message.attributes.date || new Date()).toISOString(), source: "mailbox", demo: false,
        attachments: mailboxMimeParts(message.attributes.struct)
          .filter((part) => !mailboxTextParts(message.attributes.struct).some((body) => body.partID === part.partID))
          .map((part) => ({ filename: part.disposition?.params?.filename || part.params?.name || (part.id ? "Inline image" : "Attachment"), contentType: `${part.type}/${part.subtype}`, size: part.size ?? 0, partId: part.partID, cid: part.id?.replace(/^<|>$/g, "") })),
      };
      item.threadId = threadKeyForEmail(item);
      items.push(item);
    }
    if (headers.length !== ids.length) throw new Error("Mailbox changed during sync; the next check will retry the missing messages.");
    onMailbox?.({ uidValidity: box.uidvalidity, lastUid: Math.max(...ids) });
    if (!uids && !beforeUid) {
      session.verifiedAt = Date.now(); session.verifiedUid = Math.max(...results); session.checkpointVersion = versionBeforeSearch;
    }
    return items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }, onProgress);
}

export async function downloadMailboxAttachment(mailbox: ImapMailbox, uid: number, uidValidity: number, partId: string) {
  return withImap(mailbox, async (connection, box) => {
    if (box.uidvalidity !== uidValidity) throw new Error("Mailbox identifiers changed. Refresh the inbox first.");
    const [message] = await fetchParts(connection, [uid], [partId, `${partId}.MIME`]);
    const body = message?.bodies.get(partId.toUpperCase());
    const mime = message?.bodies.get(`${partId}.MIME`.toUpperCase());
    if (!body || !mime) throw new Error("Attachment is no longer available.");
    const parsed = await simpleParser(Buffer.concat([mime, Buffer.from("\r\n"), body]));
    const attachment = parsed.attachments[0];
    if (!attachment) throw new Error("This part is not a downloadable attachment.");
    return { content: attachment.content, filename: attachment.filename || "Attachment", contentType: attachment.contentType };
  });
}
