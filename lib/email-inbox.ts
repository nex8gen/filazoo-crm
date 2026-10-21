import type { DataMode, EmailDraft, Reply } from "./types.ts";
import { getEffectiveMailbox, mailboxHasImap, mailboxHasSmtp } from "./data/mailboxes.ts";
import { getEmailAutomationSettings, listEmailInboxStates, listSentMailboxMessages, type EmailCategory, type EmailFolderState } from "./data/email-state.ts";
import { getViewer } from "./auth.ts";
import { normalizeReferences, threadKeyForEmail } from "./email-threading.ts";

export type InboxEmailItem = {
  id: string;
  from?: string;
  direction: "inbound" | "outbound";
  status: string;
  subject: string;
  contact: string;
  company: string;
  preview: string;
  body: string;
  html?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  timestamp: string;
  step?: string;
  demo?: boolean;
  category?: EmailCategory | null;
  starred?: boolean;
  read?: boolean;
  folder?: EmailFolderState;
  followUpAt?: string | null;
};

export type AutomationFlowStep = {
  id: string;
  title: string;
  delay: string;
  action: string;
  enabled: boolean;
};

export type EmailInboxBackendData = {
  mode: DataMode;
  mailboxConfigured: boolean;
  sendConfigured: boolean;
  inboxConfigured: boolean;
  inboxError: string | null;
  aiConfigured: boolean;
  defaultMailboxEmail: string | null;
  emails: InboxEmailItem[];
  automation: {
    enabled: boolean;
    steps: AutomationFlowStep[];
    queueCount: number;
  };
};

function toPreview(text: string | null | undefined) {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean || "No message preview available.";
}

type MailboxInboxSource = {
  id?: string;
  direction?: "inbound" | "outbound";
  status?: string;
  subject?: string;
  contact?: string;
  company?: string;
  preview?: string;
  body?: string;
  html?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  timestamp?: string;
};

function plainTextFromHtml(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function embedInlineImages(html: string, attachments: Array<{ cid?: string; content: Buffer; contentType: string }>) {
  return attachments.reduce((result, attachment) => {
    if (!attachment.cid || !attachment.contentType.startsWith("image/")) return result;
    const dataUrl = `data:${attachment.contentType};base64,${attachment.content.toString("base64")}`;
    return result.replace(new RegExp(`cid:${escapeRegExp(attachment.cid)}`, "gi"), dataUrl);
  }, html);
}

export async function fetchMailboxInboxMessages(mailbox: {
  email: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapUsername: string | null;
  imapPassword: string | null;
} | null | undefined): Promise<InboxEmailItem[]> {
  if (!mailbox || !mailbox.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) {
    return [];
  }

  const [{ default: Imap }, { simpleParser }] = await Promise.all([
    import("imap"),
    import("mailparser"),
  ]);

  const imapHost = mailbox.imapHost;
  const imapUsername = mailbox.imapUsername;
  const imapPassword = mailbox.imapPassword;

  return new Promise((resolve, reject) => {
    const items: InboxEmailItem[] = [];
    const pending: Array<Promise<void>> = [];
    const connection = new Imap({
      user: imapUsername,
      password: imapPassword,
      host: imapHost,
      port: mailbox.imapPort ?? 993,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: true,
        servername: imapHost,
        minVersion: "TLSv1.2",
      },
      authTimeout: 30000,
      connTimeout: 15000,
    });

    connection.once("error", (error) => {
      reject(error);
    });

    connection.once("ready", () => {
      connection.openBox("INBOX", false, (openError) => {
        if (openError) {
          connection.end();
          reject(openError);
          return;
        }

        connection.search(["ALL"], (searchError, results) => {
          if (searchError) {
            connection.end();
            reject(searchError);
            return;
          }

          if (!results || results.length === 0) {
            connection.end();
            resolve([]);
            return;
          }

          const ids = [...results].slice(-20).reverse();
          const fetch = connection.fetch(ids, { bodies: "", markSeen: false });

          fetch.on("message", (msg, seqno) => {
            const parseTask = new Promise<void>((messageResolve, messageReject) => {
              msg.on("body", (stream) => {
                const chunks: Buffer[] = [];
                stream.on("data", (chunk) => {
                  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                stream.on("end", async () => {
                  try {
                    const parsed = await simpleParser(Buffer.concat(chunks));
                    const from = parsed.from?.value?.[0];
                    const sender = from?.address || mailbox.email || "Unknown sender";
                    const rawHtml = typeof parsed.html === "string" ? parsed.html.trim() : "";
                    const emailHtml = rawHtml ? embedInlineImages(rawHtml, parsed.attachments) : null;
                    const bodyText = (parsed.text || (emailHtml ? plainTextFromHtml(emailHtml) : "")).trim() || "No email body available.";
                    const messageId = parsed.messageId || null;
                    const inReplyTo = parsed.inReplyTo || null;
                    const references = normalizeReferences(parsed.references);
                    const id = messageId ? `imap-${messageId}` : `imap-${seqno}-${Date.now()}`;
                    const item: InboxEmailItem = {
                      id,
                      direction: "inbound",
                      status: "Received",
                      subject: parsed.subject || "New inbound email",
                      contact: sender,
                      company: "Unknown company",
                      preview: toPreview(bodyText),
                      body: bodyText,
                      html: emailHtml,
                      messageId,
                      inReplyTo,
                      references,
                      timestamp: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
                      demo: true,
                    };
                    item.threadId = threadKeyForEmail(item);
                    items.push(item);
                    messageResolve();
                  } catch (error) {
                    messageReject(error instanceof Error ? error : new Error("Unable to parse the inbound email."));
                  }
                });
              });
            });

            pending.push(parseTask);
          });

          fetch.once("error", (error) => {
            connection.end();
            reject(error);
          });

          fetch.once("end", async () => {
            try {
              await Promise.all(pending);
              resolve(items.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()));
            } catch (error) {
              reject(error instanceof Error ? error : new Error("Unable to sync the mailbox inbox."));
            } finally {
              connection.end();
            }
          });
        });
      });
    });

    connection.connect();
  });
}

export function buildInboxEmailItems({
  drafts = [],
  replies = [],
  inbound = [],
}: {
  drafts?: EmailDraft[];
  replies?: Reply[];
  inbound?: InboxEmailItem[] | MailboxInboxSource[];
} = {}): InboxEmailItem[] {
  const seen = new Set<string>();

  const inboundItems = inbound.map((message, index) => {
    const item: InboxEmailItem = {
      id: message.id || `imap-${index}`,
      direction: "inbound",
      status: message.status || "Received",
      subject: message.subject || "New inbound email",
      contact: message.contact || "Unknown contact",
      company: message.company || "Unknown company",
      preview: toPreview(message.preview || message.body),
      body: message.body || "No email body available.",
      html: message.html ?? null,
      threadId: message.threadId ?? null,
      messageId: message.messageId ?? null,
      inReplyTo: message.inReplyTo ?? null,
      references: message.references ?? [],
      timestamp: message.timestamp || new Date().toISOString(),
      demo: true,
    };
    item.threadId = threadKeyForEmail(item);
    seen.add(item.id);
    return item;
  });

  const replyItems = replies.map((reply, index) => {
    const id = reply.id || `reply-${index}`;
    if (seen.has(id)) return null;
    const item: InboxEmailItem = {
      id,
      direction: "inbound",
      status: "Received",
      subject: reply.subject || "New inbound email",
      contact: reply.contact || "Unknown contact",
      company: reply.company || "Unknown company",
      preview: toPreview(reply.body),
      body: reply.body || "No email body available.",
      timestamp: reply.receivedAt || new Date().toISOString(),
      demo: true,
    };
    item.threadId = threadKeyForEmail(item);
    seen.add(id);
    return item;
  }).filter((item): item is InboxEmailItem => item !== null);

  const outboundItems = drafts.map((draft, index) => {
    const id = draft.id || `draft-${index}`;
    if (seen.has(id)) return null;
    const item: InboxEmailItem = {
      id,
      direction: "outbound",
      status: draft.status,
      subject: draft.subject || "Untitled draft",
      contact: draft.contact || "Unknown contact",
      company: draft.company || "Unknown company",
      preview: toPreview(draft.preview),
      body: draft.preview || "No email body available.",
      timestamp: new Date().toISOString(),
      step: `Step ${draft.step} of 3`,
      demo: true,
    };
    item.threadId = threadKeyForEmail(item);
    seen.add(id);
    return item;
  }).filter((item): item is InboxEmailItem => item !== null);

  return [...inboundItems, ...replyItems, ...outboundItems].sort((left, right) => {
    const directionOrder = { inbound: 0, outbound: 1 };
    const directionDelta = directionOrder[left.direction] - directionOrder[right.direction];
    if (directionDelta !== 0) return directionDelta;
    return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
  });
}

export async function getEmailInboxBackendData({ syncMailbox = true }: { syncMailbox?: boolean } = {}): Promise<EmailInboxBackendData> {
  const { listEmailDrafts, listReplies } = await import("./data/crm.ts");
  const viewer = await getViewer();
  if (!viewer) throw new Error("Authentication required.");
  const [{ emails, mode }, { replies }, defaultMailbox, sentMessages, states] = await Promise.all([
    listEmailDrafts(),
    listReplies(),
    getEffectiveMailbox(viewer.id).catch(() => null),
    listSentMailboxMessages(viewer.id).catch(() => []),
    listEmailInboxStates(viewer.id).catch(() => new Map()),
  ]);

  let liveInbound: InboxEmailItem[] = [];
  let inboxError: string | null = null;
  if (syncMailbox && mailboxHasImap(defaultMailbox)) {
    try {
      liveInbound = await fetchMailboxInboxMessages(defaultMailbox);
    } catch (error) {
      inboxError = error instanceof Error ? error.message : "Unable to connect to the mailbox inbox.";
      console.warn("Unable to sync mailbox inbox:", inboxError);
    }
  }

  const inbox = [...buildInboxEmailItems({ drafts: emails, replies, inbound: liveInbound }), ...sentMessages]
    .map((item) => ({ ...item, ...(states.get(item.id) ?? {}) }));
  const defaultMailboxEmail = defaultMailbox?.email || null;
  const sendConfigured = mailboxHasSmtp(defaultMailbox);
  const inboxConfigured = mailboxHasImap(defaultMailbox);
  const mailboxConfigured = sendConfigured && inboxConfigured;

  const aiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const automation = await getEmailAutomationSettings(
    viewer.id,
    inbox.filter((item) => item.direction === "inbound").length,
  ).catch(() => ({ enabled: false, queueCount: 0, steps: [] }));

  return {
    mode,
    mailboxConfigured,
    sendConfigured,
    inboxConfigured,
    inboxError,
    aiConfigured,
    defaultMailboxEmail,
    emails: inbox,
    automation,
  };
}
