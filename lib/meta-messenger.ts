import crypto from "node:crypto";

import { env, hasSupabaseConfig } from "./env.ts";
import { createSupabaseAdmin } from "./supabase/admin.ts";
import { claimNextBdSalesManager } from "./lead-assignment.ts";
import { twilioClient } from "./twilio-messaging.ts";

const graphApiVersion = env.META_GRAPH_API_VERSION;
type UnknownRecord = Record<string, unknown>;
export type MetaChannel = "facebook" | "instagram" | "whatsapp";

export type FacebookMessageRecord = {
  id: string;
  threadId: string;
  pageId: string;
  senderId: string;
  recipientId: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string;
  timestamp: string;
  customerName: string;
  rawPayload: UnknownRecord;
  channel: MetaChannel;
};

export type FacebookLeadEvent = {
  leadgenId: string;
  pageId: string;
  formId: string | null;
  adId: string | null;
  adGroupId: string | null;
  createdTime: string;
  rawPayload: UnknownRecord;
};

export type FacebookWebhookPayload = { messages: FacebookMessageRecord[]; leads: FacebookLeadEvent[] };

export type MetaThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  type: string;
  status: "received" | "sent" | "failed";
  createdAt: string;
};

export type MetaConversationThread = {
  id: string;
  customerId: string;
  customer: string;
  pageId: string;
  status: "New" | "Open" | "Follow-up";
  unread: number;
  lastMessage: string;
  updatedAt: string;
  replyWindowEndsAt: string | null;
  replyWindowOpen: boolean;
  messages: MetaThreadMessage[];
  channel: MetaChannel;
};

export type MetaLead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  formId: string | null;
  adId: string | null;
  createdAt: string;
  ownerId: string | null;
  ownerName: string;
};

export type MetaConnectionStatus = {
  configured: boolean;
  pageId: string | null;
  pageName: string | null;
  graphApiVersion: string;
  callbackUrl: string;
  missing: string[];
  error: string | null;
  facebookConfigured: boolean;
  whatsappConfigured: boolean;
  whatsappSender: string | null;
  whatsappSandbox: boolean;
  instagramConfigured: boolean;
  instagramAccountId: string | null;
  instagramName: string | null;
};

export type MetaInboxData = {
  threads: MetaConversationThread[];
  leads: MetaLead[];
  connection: MetaConnectionStatus;
  dataError: string | null;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 1_000_000_000_000 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const numeric = Number(value);
    return new Date(value.length <= 10 ? numeric * 1000 : numeric).toISOString();
  }
  return new Date().toISOString();
}

function extractMessengerBody(event: UnknownRecord) {
  const message = asRecord(event.message);
  const postback = asRecord(event.postback);
  if (message) {
    const text = asString(message.text);
    if (text) return { body: text, type: "text", message };
    const attachments = asArray(message.attachments);
    if (attachments.length > 0) {
      const first = asRecord(attachments[0]);
      const type = asString(first?.type) ?? "attachment";
      return { body: `[${type} attachment]`, type, message };
    }
  }
  if (postback) {
    return {
      body: asString(postback.title) ?? asString(postback.payload) ?? "Messenger postback",
      type: "postback",
      message: postback,
    };
  }
  return null;
}

export function buildMetaSignature(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifyMetaSignature(secret: string, body: string, signature: string | null | undefined) {
  if (!secret || !signature) return false;
  const provided = signature.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = buildMetaSignature(secret, body);
  if (!/^[a-f0-9]{64}$/.test(provided) || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function normalizeMetaPayload(payload: unknown): FacebookWebhookPayload {
  const root = asRecord(payload);
  if (!root || (root.object !== "page" && root.object !== "instagram")) return { messages: [], leads: [] };
  const channel: MetaChannel = root.object === "instagram" ? "instagram" : "facebook";
  const messages: FacebookMessageRecord[] = [];
  const leads: FacebookLeadEvent[] = [];

  for (const rawEntry of asArray(root.entry)) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;
    const pageId = asString(entry.id) ?? "";

    for (const rawEvent of asArray(entry.messaging)) {
      const event = asRecord(rawEvent);
      const sender = asRecord(event?.sender);
      const recipient = asRecord(event?.recipient);
      if (!event || !sender || !recipient) continue;
      const senderId = asString(sender.id) ?? "";
      const recipientId = asString(recipient.id) ?? pageId;
      const content = extractMessengerBody(event);
      if (!senderId || !recipientId || !content) continue;
      const isEcho = asRecord(event.message)?.is_echo === true;
      const direction = isEcho || senderId === pageId ? "outbound" : "inbound";
      const threadId = direction === "inbound" ? senderId : recipientId;
      const messageId = asString(content.message.mid) ?? `${threadId}-${event.timestamp ?? Date.now()}`;
      messages.push({
        id: messageId,
        threadId,
        pageId: pageId || (direction === "inbound" ? recipientId : senderId),
        senderId,
        recipientId,
        direction,
        type: content.type,
        body: content.body,
        timestamp: metaTimestamp(event.timestamp),
        customerName: threadId,
        rawPayload: event,
        channel,
      });
    }

    if (channel === "facebook") for (const rawChange of asArray(entry.changes)) {
      const change = asRecord(rawChange);
      const value = asRecord(change?.value);
      if (!change || change.field !== "leadgen" || !value) continue;
      const leadgenId = asString(value.leadgen_id);
      if (!leadgenId) continue;
      leads.push({
        leadgenId,
        pageId: asString(value.page_id) ?? pageId,
        formId: asString(value.form_id),
        adId: asString(value.ad_id),
        adGroupId: asString(value.adgroup_id),
        createdTime: metaTimestamp(value.created_time),
        rawPayload: value,
      });
    }
  }
  return { messages, leads };
}

async function graphRequest(path: string, init?: RequestInit, options?: { token?: string; host?: string }) {
  const token = options?.token ?? env.META_FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) return { ok: false as const, error: "Meta access token is not configured." };
  let response: Response;
  try {
    response = await fetch(`https://${options?.host ?? "graph.facebook.com"}/${graphApiVersion}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Meta Graph API could not be reached." };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = asRecord(asRecord(payload)?.error);
    return { ok: false as const, error: asString(errorPayload?.message) ?? `Meta Graph API returned HTTP ${response.status}.` };
  }
  return { ok: true as const, payload: asRecord(payload) ?? {} };
}

async function fetchMessengerProfile(customerId: string, channel: MetaChannel) {
  const fields = channel === "instagram" ? "name,username" : "first_name,last_name,name";
  const result = await graphRequest(`${encodeURIComponent(customerId)}?fields=${fields}`);
  if (!result.ok) return null;
  const fallback = [asString(result.payload.first_name), asString(result.payload.last_name)].filter(Boolean).join(" ");
  return (asString(result.payload.name) ?? fallback) || null;
}

type MetaMessageInsert = {
  messageId: string;
  threadId: string;
  pageId: string;
  senderId: string;
  recipientId: string;
  customerName: string;
  direction: "inbound" | "outbound";
  body: string;
  messageType: string;
  status: "received" | "sent" | "failed";
  createdAt: string;
  rawPayload: UnknownRecord | null;
  channel: MetaChannel;
};

export async function saveMetaMessage(input: MetaMessageInsert, ignoreDuplicates = false) {
  if (!hasSupabaseConfig()) return { ok: false as const, saved: false, error: "Supabase is not configured." };
  const { error } = await createSupabaseAdmin().from("meta_messages").upsert({
    message_id: input.messageId,
    thread_id: input.threadId,
    page_id: input.pageId,
    sender_id: input.senderId,
    recipient_id: input.recipientId,
    customer_name: input.customerName,
    direction: input.direction,
    body: input.body,
    message_type: input.messageType,
    status: input.status,
    source: input.channel === "whatsapp" ? "twilio_whatsapp" : input.channel === "instagram" ? "instagram_messaging" : "facebook_messenger",
    raw_payload: input.rawPayload,
    created_at: input.createdAt,
  }, { onConflict: "message_id", ignoreDuplicates });
  if (error) return { ok: false as const, saved: false, error: error.message };
  return { ok: true as const, saved: true };
}

export async function saveInboundMetaMessage(message: FacebookMessageRecord) {
  const customerName = message.direction === "inbound"
    ? (await fetchMessengerProfile(message.threadId, message.channel)) ?? message.customerName
    : message.customerName;
  return saveMetaMessage({
    messageId: message.id,
    threadId: message.threadId,
    pageId: message.pageId,
    senderId: message.senderId,
    recipientId: message.recipientId,
    customerName,
    direction: message.direction,
    body: message.body,
    messageType: message.type,
    status: message.direction === "inbound" ? "received" : "sent",
    createdAt: message.timestamp,
    rawPayload: message.rawPayload,
    channel: message.channel,
  });
}

function normalizeLeadFields(fieldData: unknown) {
  const normalized: Record<string, string> = {};
  for (const rawField of asArray(fieldData)) {
    const field = asRecord(rawField);
    const name = asString(field?.name);
    if (!name) continue;
    normalized[name] = asArray(field?.values).map(String).filter(Boolean).join(", ");
  }
  return normalized;
}

export async function saveMetaLead(event: FacebookLeadEvent) {
  if (!hasSupabaseConfig()) return { ok: false as const, saved: false, error: "Supabase is not configured." };
  const detail = await graphRequest(`${encodeURIComponent(event.leadgenId)}?fields=id,created_time,ad_id,form_id,field_data`);
  const detailPayload = detail.ok ? detail.payload : {};
  const fields = normalizeLeadFields(detailPayload.field_data);
  const fullName = fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(" ") || null;
  const admin = createSupabaseAdmin();
  const { data: existing } = await admin.from("meta_leads").select("owner_id,assignment_method").eq("leadgen_id", event.leadgenId).maybeSingle();
  const ownerId = existing?.owner_id ?? await claimNextBdSalesManager(admin);
  const { error } = await admin.from("meta_leads").upsert({
    leadgen_id: event.leadgenId,
    page_id: event.pageId,
    form_id: asString(detailPayload.form_id) ?? event.formId,
    ad_id: asString(detailPayload.ad_id) ?? event.adId,
    adgroup_id: event.adGroupId,
    full_name: fullName,
    email: fields.email || null,
    phone: fields.phone_number || fields.phone || null,
    owner_id: ownerId,
    assignment_method: existing?.assignment_method ?? (ownerId ? "automatic" : null),
    field_data: detailPayload.field_data ?? [],
    raw_payload: { webhook: event.rawPayload, detail: detailPayload, detail_error: detail.ok ? null : detail.error },
    created_at: asString(detailPayload.created_time) ?? event.createdTime,
  }, { onConflict: "leadgen_id" });
  if (error) return { ok: false as const, saved: false, error: error.message };
  return { ok: true as const, saved: true, detailFetched: detail.ok };
}

export async function sendMetaTextMessage({ to, text, channel = "facebook" }: { to: string; text: string; channel?: MetaChannel }) {
  const from = channel === "whatsapp" ? env.TWILIO_WHATSAPP_FROM : channel === "facebook" ? env.TWILIO_FACEBOOK_FROM : undefined;
  if (channel === "whatsapp" || from) {
    if (!from || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return { ok: false as const, error: "Twilio sender is not configured." };
    const prefix = channel === "whatsapp" ? "whatsapp:" : "messenger:";
    // Replies are limited to existing conversations within the customer service window.
    if (!hasSupabaseConfig()) return { ok: false as const, error: "CRM storage is not configured." };
    const { data: inbound, error } = await createSupabaseAdmin().from("meta_messages")
      .select("created_at").eq("thread_id", to).eq("page_id", from.slice(prefix.length))
      .eq("source", channel === "whatsapp" ? "twilio_whatsapp" : "facebook_messenger")
      .eq("direction", "inbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !inbound || new Date(inbound.created_at).getTime() < Date.now() - 86_400_000) {
      return { ok: false as const, error: "The 24-hour reply window is closed. Wait for a new customer message." };
    }
    try {
      const message = await twilioClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN).messages.create({ from, to: `${prefix}${to}`, body: text });
      const createdAt = message.dateCreated?.toISOString() ?? new Date().toISOString();
      const saved = await saveMetaMessage({ messageId: message.sid, threadId: to,
        pageId: from.slice(prefix.length), senderId: from.slice(prefix.length), recipientId: to,
        customerName: to, direction: "outbound", body: text, messageType: "text", status: "sent",
        createdAt, rawPayload: { provider: "twilio", status: message.status }, channel });
      return { ok: true as const, messageId: message.sid, createdAt, saved: saved.ok };
    } catch (error) {
      const failure = error as { code?: number; status?: number; name?: string };
      console.error("Twilio reply failed", { code: failure.code, status: failure.status, name: failure.name });
      if (failure.code === 21654) {
        return { ok: false as const, error: "Twilio requires an approved message template (21654). Your Twilio trial cannot send this typed reply. Upgrade your Twilio account to enable free-text messaging." };
      }
      const code = typeof failure.code === "number" ? ` (Twilio ${failure.code})` : "";
      return { ok: false as const, error: `Twilio could not accept the reply${code}. Check the sender and Twilio message logs.` };
    }
  }
  const accountId = env.META_FACEBOOK_PAGE_ID;
  const token = env.META_FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token || !accountId) {
    return { ok: false as const, error: "Meta Page Messenger credentials are not configured." };
  }
  const result = await graphRequest(`${encodeURIComponent(accountId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ recipient: { id: to }, messaging_type: "RESPONSE", message: { text } }),
  }, { token });
  if (!result.ok) return result;
  const messageId = asString(result.payload.message_id) ?? `facebook-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const saved = await saveMetaMessage({
    messageId,
    threadId: to,
    pageId: accountId,
    senderId: accountId,
    recipientId: to,
    customerName: to,
    direction: "outbound",
    body: text,
    messageType: "text",
    status: "sent",
    createdAt,
    rawPayload: { recipient: { id: to }, message: { text } },
    channel,
  });
  if (!saved.ok) console.warn("Facebook Messenger reply sent but not stored in Supabase", { error: saved.error });
  return { ok: true as const, messageId, createdAt, saved: saved.ok };
}

async function getMetaConnectionStatus(): Promise<MetaConnectionStatus> {
  const required = {
    META_WEBHOOK_SECRET: env.META_WEBHOOK_SECRET,
    META_VERIFY_TOKEN: env.META_VERIFY_TOKEN,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  const hasFacebookCredentials = Boolean(env.META_FACEBOOK_PAGE_ACCESS_TOKEN && env.META_FACEBOOK_PAGE_ID);
  if (!hasFacebookCredentials) missing.push("META_FACEBOOK_PAGE_ACCESS_TOKEN", "META_FACEBOOK_PAGE_ID");
  const callbackUrl = new URL("/api/meta/webhook", env.NEXT_PUBLIC_APP_URL).toString();
  const facebook = hasFacebookCredentials
    ? await graphRequest(`${encodeURIComponent(env.META_FACEBOOK_PAGE_ID!)}?fields=id,name,instagram_business_account{id,name,username}`)
    : null;
  const twilioConfigured = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WEBHOOK_URL);
  const whatsappConfigured = Boolean(twilioConfigured && env.TWILIO_WHATSAPP_FROM);
  const facebookConfigured = Boolean(facebook?.ok || (twilioConfigured && env.TWILIO_FACEBOOK_FROM));
  const instagramAccount = facebook?.ok ? asRecord(facebook.payload.instagram_business_account) : null;
  const instagramConfigured = Boolean(instagramAccount?.id);
  const errors = [facebook && !facebook.ok ? `Meta: ${facebook.error}` : null].filter(Boolean);
  return {
    configured: whatsappConfigured || Boolean(twilioConfigured && env.TWILIO_FACEBOOK_FROM) || (missing.length === 0 && (facebookConfigured || instagramConfigured)),
    pageId: env.META_FACEBOOK_PAGE_ID || null,
    pageName: facebook?.ok ? asString(facebook.payload.name) : null,
    graphApiVersion,
    callbackUrl,
    missing,
    error: errors.length ? errors.join(" ") : null,
    facebookConfigured,
    whatsappConfigured,
    whatsappSender: env.TWILIO_WHATSAPP_FROM?.replace(/^whatsapp:/, "") || null,
    whatsappSandbox: env.TWILIO_WHATSAPP_FROM === "whatsapp:+14155238886",
    instagramConfigured,
    instagramAccountId: asString(instagramAccount?.id),
    instagramName: asString(instagramAccount?.username) ?? asString(instagramAccount?.name),
  };
}

function mapThreadRows(rows: UnknownRecord[]): MetaConversationThread[] {
  const byThread = new Map<string, MetaConversationThread>();
  for (const row of [...rows].reverse()) {
    const threadId = String(row.thread_id ?? row.id);
    const channel: MetaChannel = row.source === "twilio_whatsapp" ? "whatsapp" : row.source === "instagram_messaging" ? "instagram" : "facebook";
    const inboxThreadId = `${channel}:${row.page_id}:${threadId}`;
    const direction = row.direction === "outbound" ? "outbound" : "inbound";
    const createdAt = String(row.created_at ?? new Date().toISOString());
    const existing = byThread.get(inboxThreadId);
    const message: MetaThreadMessage = {
      id: String(row.message_id ?? row.id),
      direction,
      body: String(row.body ?? "Messenger event"),
      type: String(row.message_type ?? "text"),
      status: row.status === "failed" ? "failed" : direction === "outbound" ? "sent" : "received",
      createdAt,
    };
    const inboundWindow = direction === "inbound" ? new Date(new Date(createdAt).getTime() + 86_400_000).toISOString() : null;
    if (!existing) {
      byThread.set(inboxThreadId, {
        id: inboxThreadId,
        customerId: threadId,
        customer: String(row.customer_name ?? threadId),
        pageId: String(row.page_id ?? env.META_FACEBOOK_PAGE_ID ?? ""),
        status: direction === "inbound" ? "New" : "Open",
        unread: direction === "inbound" ? 1 : 0,
        lastMessage: message.body,
        updatedAt: createdAt,
        replyWindowEndsAt: inboundWindow,
        replyWindowOpen: Boolean(inboundWindow && new Date(inboundWindow).getTime() > Date.now()),
        messages: [message],
        channel,
      });
      continue;
    }
    existing.messages.push(message);
    existing.lastMessage = message.body;
    existing.updatedAt = createdAt;
    if (direction === "inbound") {
      existing.customer = String(row.customer_name ?? existing.customer);
      existing.unread += 1;
      existing.replyWindowEndsAt = inboundWindow;
      existing.replyWindowOpen = Boolean(inboundWindow && new Date(inboundWindow).getTime() > Date.now());
    }
  }
  return Array.from(byThread.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getMetaInboxData(): Promise<MetaInboxData> {
  const connection = await getMetaConnectionStatus();
  if (!hasSupabaseConfig()) return { threads: [], leads: [], connection, dataError: "Supabase is not configured." };
  const client = createSupabaseAdmin();
  const [messagesResult, leadsResult] = await Promise.all([
    client.from("meta_messages").select("id,message_id,thread_id,page_id,customer_name,direction,body,message_type,status,source,created_at").order("created_at", { ascending: false }).limit(300),
    client.from("meta_leads").select("leadgen_id,full_name,email,phone,form_id,ad_id,owner_id,created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const errors = [messagesResult.error?.message, leadsResult.error?.message].filter(Boolean);
  const ownerIds = [...new Set((leadsResult.data ?? []).map((row) => row.owner_id).filter((value): value is string => Boolean(value)))];
  const { data: owners } = ownerIds.length ? await client.from("workspace_members").select("user_id,display_name").in("user_id", ownerIds) : { data: [] };
  const ownerNames = new Map((owners ?? []).map((owner) => [owner.user_id, owner.display_name || "BD Sales Manager"]));
  const leads: MetaLead[] = (leadsResult.data ?? []).map((row) => ({
    id: String(row.leadgen_id),
    name: String(row.full_name ?? row.email ?? "Facebook lead"),
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    formId: row.form_id ? String(row.form_id) : null,
    adId: row.ad_id ? String(row.ad_id) : null,
    createdAt: String(row.created_at),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    ownerName: row.owner_id ? ownerNames.get(String(row.owner_id)) || "BD Sales Manager" : "Unassigned",
  }));
  return {
    threads: mapThreadRows((messagesResult.data ?? []) as UnknownRecord[]),
    leads,
    connection,
    dataError: errors.length > 0 ? errors.join(" ") : null,
  };
}
