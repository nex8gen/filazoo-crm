import Imap from "imap";
import { simpleParser } from "mailparser";
import type { InboxEmailItem } from "./email-inbox.ts";
import { referenceHeaderIds, threadKeyForEmail } from "./email-threading.ts";
import { selectMailboxUids, type MailboxCursor, type MailboxBatch } from "./mailbox-sync.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { providerFolderKind, type ProviderFolder } from "./email-provider.ts";
import { emailMimeParameter } from "./email-mime.ts";

export type ImapMailbox = { email: string | null; imapHost: string | null; imapPort: number | null; imapUsername: string | null; imapPassword: string | null };
export type MimePart = { partID: string; type: string; subtype: string; id?: string; location?: string; size?: number; params?: Record<string, string>; disposition?: { type?: string; params?: Record<string, string> } | null };

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
    && !emailMimeParameter(part.disposition?.params, "filename") && !emailMimeParameter(part.params, "name"));
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

type ImapSession = { connection: Imap; box: Imap.Box; folder: string; readOnly: boolean; version: number; checkpointVersion?: number; verifiedUid?: number; verifiedAt?: number };
export function canReuseMailboxCheckpoint(cursor: MailboxCursor | undefined, state: { uidValidity: number; version: number; checkpointVersion?: number; verifiedUid?: number; verifiedAt?: number }, now = Date.now()) {
  return Boolean(cursor && cursor.uidValidity === state.uidValidity && cursor.lastUid === state.verifiedUid
    && state.version === state.checkpointVersion && state.verifiedAt && now - state.verifiedAt < 30000);
}
type PoolEntry = { session: Promise<ImapSession>; tail: Promise<unknown>; expiry?: ReturnType<typeof setTimeout> };
const sessions = new Map<string, PoolEntry>();
const syncSessionScope = new AsyncLocalStorage<{ prefix: string; timeoutMs: number }>();
let syncScopeSequence = 0;

/** Bound background operations and close only this invocation's provider sessions.
 * Foreground attachment downloads retain their separate pool and longer timeout. */
export async function withMailboxSyncSessions<T>(run: () => Promise<T>, timeoutMs = 25_000) {
  const prefix = `sync-${++syncScopeSequence}:`;
  return syncSessionScope.run({ prefix, timeoutMs }, async () => {
    try { return await run(); }
    finally {
      const { closeMailboxFlowScope } = await import("./mailbox-flow.ts");
      closeMailboxFlowScope(prefix);
      await Promise.all([...sessions].filter(([key]) => key.startsWith(prefix)).map(async ([key, entry]) => {
        sessions.delete(key); clearTimeout(entry.expiry);
        try { (await entry.session).connection.destroy(); } catch { /* Failed connections already closed. */ }
      }));
    }
  });
}

export async function closeMailboxSessions() {
  const entries = [...sessions.values()];
  sessions.clear();
  await Promise.all(entries.map(async (entry) => {
    clearTimeout(entry.expiry);
    try { (await entry.session).connection.destroy(); } catch { /* Failed connections are already closed. */ }
  }));
}

function connectImap(mailbox: ImapMailbox, onProgress?: (stage: string) => void, folder = "INBOX", readOnly = true): Promise<ImapSession> {
  if (!mailbox.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) throw new Error("Mailbox IMAP settings are incomplete.");
  return new Promise((resolve, reject) => {
    const connection = new Imap({ user: mailbox.imapUsername!, password: mailbox.imapPassword!, host: mailbox.imapHost!, port: mailbox.imapPort ?? 993, tls: true,
      tlsOptions: { rejectUnauthorized: true, servername: mailbox.imapHost!, minVersion: "TLSv1.2" }, authTimeout: 15000, connTimeout: 15000 });
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Mailbox connection timed out. Saved messages are still available.")), syncSessionScope.getStore()?.timeoutMs ?? 90000);
    function finish(error?: Error, result?: ImapSession) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { connection.destroy(); reject(error); } else resolve(result!);
    }
    connection.once("error", finish);
    connection.once("close", () => { if (!settled) finish(new Error("Mailbox connection closed before the download completed.")); });
    connection.once("ready", () => {
      onProgress?.(`Authenticated; opening ${folder}`);
      connection.openBox(folder, readOnly, (error, box) => {
        if (error) { finish(error); return; }
        const session: ImapSession = { connection, box, folder, readOnly, version: 0 };
        connection.on("mail", () => { session.version += 1; });
        connection.on("expunge", () => { session.version += 1; });
        connection.on("update", () => { session.version += 1; });
        finish(undefined, session);
      });
    });
    connection.connect();
  });
}

async function withImap<T>(mailbox: ImapMailbox, action: (connection: Imap, box: Imap.Box, session: ImapSession) => Promise<T>, onProgress?: (stage: string) => void, folder = "INBOX", readOnly = true, reconnects = 0): Promise<T> {
  // Reuse authenticated sessions on warm servers. Opening a new provider session
  // on every 10-second poll can cost far more than fetching the new messages.
  // Credentials are only included in this in-memory hash, never in DB or logs.
  const key = (syncSessionScope.getStore()?.prefix || "") + createHash("sha256").update(JSON.stringify(mailbox)).digest("hex");
  let entry = sessions.get(key);
  if (!entry) {
    const session = connectImap(mailbox, onProgress, folder, readOnly);
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
    if (sessions.get(key) !== current || session.connection.state !== "authenticated") {
      if (sessions.get(key) === current) sessions.delete(key);
      if (reconnects >= 1) throw new Error("Mailbox connection reset. Please refresh and try again.");
      return withImap(mailbox, action, onProgress, folder, readOnly, reconnects + 1);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectConnection!: (error: Error) => void;
    const connectionFailure = new Promise<never>((_, reject) => { rejectConnection = reject; });
    const closed = () => rejectConnection(new Error("Mailbox connection closed during download. Try again."));
    session.connection.once("error", rejectConnection);
    session.connection.once("close", closed);
    try {
      return await Promise.race([
        (async () => {
          // One authenticated connection per account. Serialize folder changes
          // with UID operations instead of exhausting the provider's login limit.
          if (session.folder !== folder || session.readOnly !== readOnly) {
            session.box = await new Promise<Imap.Box>((resolve, reject) => session.connection.openBox(folder, readOnly, (error, box) => error ? reject(error) : resolve(box)));
            session.folder = folder; session.readOnly = readOnly; session.version++;
            session.verifiedAt = undefined; session.verifiedUid = undefined; session.checkpointVersion = undefined;
          }
          return action(session.connection, session.box, session);
        })(),
        connectionFailure,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Mailbox operation timed out. Saved messages are still available.")), syncSessionScope.getStore()?.timeoutMs ?? 90000); }),
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

export type ReceiveOptions = { limit?: number; cursor?: MailboxCursor; beforeUid?: number; onMailbox?: (cursor: MailboxCursor) => void; onBatch?: (batch: MailboxBatch) => void; onProgress?: (stage: string) => void; headersOnly?: boolean; uids?: number[]; uidValidity?: number; folder?: string; kind?: string; includePreview?: boolean };
export async function receiveMailboxMessages(mailbox: ImapMailbox, { limit = 10, cursor, beforeUid, onMailbox, onBatch, onProgress, headersOnly = true, uids, uidValidity, folder = "INBOX", kind = "inbox", includePreview = true }: ReceiveOptions = {}): Promise<InboxEmailItem[]> {
  const scope = syncSessionScope.getStore();
  if (scope) return (await import("./mailbox-flow.ts")).receiveMailboxFlow(mailbox, { limit, cursor, beforeUid, onMailbox, onBatch, onProgress, headersOnly, uids, uidValidity, folder, kind, includePreview }, scope);
  onProgress?.("Connecting to IMAP");
  return withImap(mailbox, async (connection, box, session) => {
    if (uidValidity !== undefined && uidValidity !== box.uidvalidity) throw new Error("Mailbox identifiers changed. Refresh the inbox before opening this message.");
    if (!uids && !beforeUid && canReuseMailboxCheckpoint(cursor, { ...session, uidValidity: box.uidvalidity })) {
      onProgress?.("IMAP notifications confirm no new mail");
      onMailbox?.(cursor!);
      onBatch?.({ received: 0, hasMore: false, totalMessages: box.messages?.total });
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
      onBatch?.({ received: 0, hasMore: false, totalMessages: box.messages?.total });
      return [];
    }
    // Fetch small headers and MIME structure first. Never download attachments
    // during sync: one large PDF must not block every other incoming message.
    onProgress?.(`Fetching ${ids.length} message headers`);
    const headers = await fetchParts(connection, ids, ["HEADER"], true);
    const groups = new Map<string, number[]>();
    for (const message of headers) {
      const textParts = mailboxTextParts(message.attributes.struct);
      for (const part of headersOnly ? textParts.slice(0, 1) : textParts) {
        // Small text alternatives provide useful inbox snippets without fetching
        // attachments or allowing a large message to block the header batch.
        if (headersOnly && (!includePreview || !part.size || part.size > 16_384)) continue;
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
      items.push(await parseMailboxHeader(mailbox, { headers: message.bodies.get("HEADER") || Buffer.alloc(0), uid: message.attributes.uid, uidValidity: box.uidvalidity, flags: message.attributes.flags, date: message.attributes.date, structure: message.attributes.struct }, content.get(message.attributes.uid) || [], { headersOnly, folder, kind }));
    }
    if (headers.length !== ids.length) throw new Error("Mailbox changed during sync; the next check will retry the missing messages.");
    onMailbox?.({ uidValidity: box.uidvalidity, lastUid: Math.max(...ids) });
    onBatch?.({ received: ids.length, hasMore: results.filter((uid) => uid >= startUid).length > ids.length, totalMessages: box.messages?.total });
    if (!uids && !beforeUid) {
      session.verifiedAt = Date.now(); session.verifiedUid = Math.max(...results); session.checkpointVersion = versionBeforeSearch;
    }
    return items.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }, onProgress, folder);
}

export async function downloadMailboxAttachment(mailbox: ImapMailbox, uid: number, uidValidity: number, partId: string, folder = "INBOX") {
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
  }, undefined, folder);
}

export async function listMailboxFolders(mailbox: ImapMailbox): Promise<ProviderFolder[]> {
  const scope = syncSessionScope.getStore();
  if (scope) return (await import("./mailbox-flow.ts")).listMailboxFlowFolders(mailbox, scope);
  return withImap(mailbox, async (connection) => {
    const boxes = await new Promise<Imap.MailBoxes>((resolve, reject) => connection.getBoxes((error, value) => error ? reject(error) : resolve(value)));
    const result: ProviderFolder[] = [];
    function visit(tree: Imap.MailBoxes, prefix = "") {
      for (const [name, box] of Object.entries(tree)) {
        const path = `${prefix}${name}`;
        if (!box.attribs.some((flag) => flag.toLowerCase() === "\\noselect")) result.push({ path, name, kind: providerFolderKind(path, box.attribs) });
        if (box.children) visit(box.children, `${path}${box.delimiter || "/"}`);
      }
    }
    visit(boxes);
    return result;
  });
}

export async function ensureMailboxArchive(mailbox: ImapMailbox) {
  const folders = await listMailboxFolders(mailbox);
  if (folders.some((folder) => folder.kind === "archive")) return folders;
  await withImap(mailbox, async (connection) => new Promise<void>((resolve, reject) => connection.addBox("Archive", (error) => error ? reject(error) : resolve())));
  return listMailboxFolders(mailbox);
}

/** Reconcile flags and removals independently of the new-message UID cursor. */
export async function reconcileMailboxMessages(mailbox: ImapMailbox, messages: InboxEmailItem[], folder = "INBOX") {
  const scope = syncSessionScope.getStore();
  if (scope) return (await import("./mailbox-flow.ts")).reconcileMailboxFlow(mailbox, messages, folder, scope);
  if (!messages.length) return messages;
  return withImap(mailbox, async (connection, box) => {
    if (messages.some((message) => message.uidValidity !== box.uidvalidity)) return messages;
    const available = new Set(await new Promise<number[]>((resolve, reject) => connection.search(["ALL"], (error, ids) => error ? reject(error) : resolve(ids))));
    const ids = messages.flatMap((message) => message.uid && available.has(message.uid) ? [message.uid] : []);
    const flags = new Map<number, string[]>();
    for (let offset = 0; offset < ids.length; offset += 500) {
      for (const message of await fetchParts(connection, ids.slice(offset, offset + 500), [])) flags.set(message.attributes.uid, message.attributes.flags);
    }
    return messages.map((message) => ({ ...message, providerRemoved: !available.has(message.uid!),
      read: flags.get(message.uid!)?.includes("\\Seen") ?? message.read,
      starred: flags.get(message.uid!)?.includes("\\Flagged") ?? message.starred }));
  }, undefined, folder);
}

export async function updateMailboxMessage(mailbox: ImapMailbox, uid: number, uidValidity: number, folder: string, changes: { read?: boolean; starred?: boolean; destination?: string }) {
  return withImap(mailbox, async (connection, box) => {
    if (box.uidvalidity !== uidValidity) throw new Error("Mailbox identifiers changed. Refresh before changing this message.");
    for (const [value, flag] of [[changes.read, "\\Seen"], [changes.starred, "\\Flagged"]] as const) {
      if (value === undefined) continue;
      await new Promise<void>((resolve, reject) => connection[value ? "addFlags" : "delFlags"]([uid], [flag], (error) => error ? reject(error) : resolve()));
    }
    if (changes.destination && changes.destination !== folder) {
      // node-imap's non-MOVE fallback can expunge unrelated deleted messages.
      // Require MOVE or UIDPLUS so only this specific UID can be removed.
      if (!connection.serverSupports("MOVE") && !connection.serverSupports("UIDPLUS")) throw new Error("This provider cannot safely move individual messages. Move this email in your provider's app.");
      await new Promise<void>((resolve, reject) => connection.move([uid], changes.destination!, (error) => error ? reject(error) : resolve()));
    }
  }, undefined, folder, false);
}

export async function appendMailboxSent(mailbox: ImapMailbox, raw: Buffer, messageId: string) {
  const sent = (await listMailboxFolders(mailbox)).find((folder) => folder.kind === "sent");
  if (!sent) throw new Error("The provider has no Sent folder.");
  return withImap(mailbox, async (connection) => {
    const existing = await new Promise<number[]>((resolve, reject) => connection.search([["HEADER", "MESSAGE-ID", messageId]], (error, ids) => error ? reject(error) : resolve(ids)));
    if (!existing.length) await new Promise<void>((resolve, reject) => connection.append(raw, { mailbox: sent.path, flags: ["\\Seen"] }, (error) => error ? reject(error) : resolve()));
  }, undefined, sent.path);
}

export async function downloadMailboxOriginal(mailbox: ImapMailbox, uid: number, validity: number, folder = "INBOX") {
  return withImap(mailbox, async (connection, box) => {
    if (box.uidvalidity !== validity) throw new Error("Mailbox identifiers changed. Refresh first.");
    const [message] = await fetchParts(connection, [uid], [""]);
    const raw = message?.bodies.get("");
    if (!raw) throw new Error("Original message unavailable.");
    return raw;
  }, undefined, folder);
}

export async function searchMailboxMessages(mailbox: ImapMailbox, query: string, folder = "INBOX", kind = "inbox", cachedBodyMatches = new Set<string>(), signal?: AbortSignal): Promise<InboxEmailItem[] & { fallback?: boolean }> {
  const criteria = [["OR", ["SUBJECT", query], ["OR", ["FROM", query], ["OR", ["TO", query], ["TEXT", query]]]]];
  const ids = await withImap(mailbox, async (connection) => new Promise<number[]>((resolve, reject) => connection.search(criteria, (error, ids) => error ? reject(error) : resolve(ids))), undefined, folder);
  if (ids.length) return receiveMailboxMessages(mailbox, { folder, kind, uids: ids, limit: 50 });
  // Some IMAP providers accept text searches but return no matches even for
  // known senders. Scan headers without downloading bodies or attachments.
  const available = await withImap(mailbox, async (connection) => new Promise<number[]>((resolve, reject) => connection.search(["ALL"], (error, ids) => error ? reject(error) : resolve(ids))), undefined, folder);
  const ordered = available.sort((a, b) => b - a);
  const matches: InboxEmailItem[] = [];
  const needle = query.toLowerCase();
  for (let offset = 0; offset < ordered.length && matches.length < 50; offset += 250) {
    if (signal?.aborted) throw new Error("Search cancelled.");
    const headers = await receiveMailboxMessages(mailbox, { folder, kind, uids: ordered.slice(offset, offset + 250), limit: 250, includePreview: false });
    for (const message of headers) {
      const header = [message.subject, message.from, message.contact, message.contactName, message.replyTo, ...(message.to || []).flatMap((item) => [item.name, item.address]), ...(message.cc || []).flatMap((item) => [item.name, item.address]), ...(message.attachments || []).map((item) => item.filename)].filter(Boolean).join(" ").toLowerCase();
      if (header.includes(needle) || cachedBodyMatches.has(`${message.uidValidity}:${message.uid}`)) matches.push(message);
    }
  }
  return Object.assign(matches.slice(0, 50), { fallback: true });
}

export async function parseMailboxHeader(mailbox: ImapMailbox, metadata: { headers: Buffer; uid: number; uidValidity: number; flags: string[]; date?: Date; structure: unknown }, bodies: Array<Awaited<ReturnType<typeof simpleParser>>> = [], { headersOnly = true, folder = "INBOX", kind = "inbox" }: ReceiveOptions = {}): Promise<InboxEmailItem> {
  const parsed = await simpleParser(metadata.headers);
  const plain = bodies.find((body) => body.text)?.text;
  const html = bodies.find((body) => typeof body.html === "string")?.html;
  const decodedText = plain || bodies.find((part) => part.text)?.text || "";
  const body = headersOnly ? "" : decodedText || "This email has no text body.";
  const from = parsed.from?.value[0];
  const addresses = (field: typeof parsed.to) => (Array.isArray(field) ? field.flatMap((item) => item.value) : field?.value || []).flatMap((item) => item.address ? [{ address: item.address, name: item.name }] : []);
  const outbound = kind === "sent" || kind === "drafts" || from?.address?.toLowerCase() === mailbox.email?.toLowerCase();
  const to = addresses(parsed.to), cc = addresses(parsed.cc), bcc = addresses(parsed.bcc);
  const item: InboxEmailItem = {
    id: parsed.messageId ? `imap-${parsed.messageId}` : `imap-${mailbox.email}-${metadata.uidValidity}-${metadata.uid}`,
    uid: metadata.uid, uidValidity: metadata.uidValidity, bodyLoaded: !headersOnly,
    from: from?.address, to, cc, ...(outbound ? { bcc } : {}), replyTo: parsed.replyTo?.value[0]?.address || null,
    providerFolder: folder, providerKind: kind,
    read: metadata.flags.includes("\\Seen"), starred: metadata.flags.includes("\\Flagged"),
    folder: kind === "trash" ? "trash" : kind === "archive" ? "archive" : "inbox",
    automaticResponse: (parsed.headers.has("auto-submitted") && String(parsed.headers.get("auto-submitted")).toLowerCase() !== "no")
      || /bulk|list|junk/i.test(String(parsed.headers.get("precedence") || "")) || parsed.headers.has("list-id"),
    contact: outbound ? to[0]?.address || from?.address || "Unknown recipient" : from?.address || "Unknown sender", contactName: outbound ? to[0]?.name : from?.name,
    direction: outbound ? "outbound" : "inbound", status: kind === "drafts" ? "Provider draft" : outbound ? "Sent" : "Received", subject: parsed.subject || "(No subject)", company: "Unknown company",
    // Slice Unicode code points so an emoji at the boundary cannot become an
    // unpaired surrogate rejected by the database's JSON parser.
    body, preview: Array.from(decodedText.replace(/\s+/g, " ")).slice(0, 160).join(""), html: !headersOnly && typeof html === "string" ? html : null,
    messageId: parsed.messageId || null, inReplyTo: parsed.inReplyTo || null, references: referenceHeaderIds(parsed.references),
    timestamp: (parsed.date || metadata.date || new Date()).toISOString(), source: "mailbox", demo: false,
    attachments: mailboxMimeParts(metadata.structure)
      .filter((part) => !mailboxTextParts(metadata.structure).some((body) => body.partID === part.partID))
      .map((part) => ({ filename: emailMimeParameter(part.disposition?.params, "filename") || emailMimeParameter(part.params, "name") || (part.id ? "Inline image" : "Attachment"), contentType: `${part.type}/${part.subtype}`.toLowerCase(), size: part.size ?? 0, partId: part.partID, cid: part.id?.trim().replace(/^<|>$/g, ""), contentLocation: part.location || undefined, inline: part.disposition?.type?.toLowerCase() === "inline" || Boolean(part.id && part.disposition?.type?.toLowerCase() !== "attachment") })),
  };
  item.threadId = threadKeyForEmail(item);
  return item;
}
