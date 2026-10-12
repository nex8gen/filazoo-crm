import crypto from "node:crypto";

import { hasSupabaseConfig } from "./env.ts";
import { createSupabaseAdmin } from "./supabase/admin.ts";

export type MetaMessageRecord = {
  id: string;
  from: string;
  type: string;
  body: string;
  timestamp: string;
  customerName: string;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
};

export type MetaConversationThread = {
  id: string;
  customer: string;
  phone: string;
  company: string;
  status: "New" | "Open" | "Follow-up";
  unread: number;
  lastMessage: string;
  updatedAt: string;
};

export const demoMetaThreads: MetaConversationThread[] = [
  {
    id: "thread-1",
    customer: "Ava Patel",
    phone: "+15551234567",
    company: "Northwind Plastics",
    status: "New",
    unread: 2,
    lastMessage: "Hi, is the PETG still available for next week?",
    updatedAt: "2 minutes ago",
  },
  {
    id: "thread-2",
    customer: "Miguel Ruiz",
    phone: "+15557654321",
    company: "Blue Harbor Packaging",
    status: "Open",
    unread: 1,
    lastMessage: "We need a quote for 3,200 kg with a sample pack.",
    updatedAt: "18 minutes ago",
  },
  {
    id: "thread-3",
    customer: "Nina Foster",
    phone: "+15550001122",
    company: "Evergreen Retail",
    status: "Follow-up",
    unread: 0,
    lastMessage: "Thanks, I’ll review your catalog and come back to you.",
    updatedAt: "1 hour ago",
  },
];

export function buildMetaSignature(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifyMetaSignature(secret: string, body: string, signature: string | null | undefined) {
  if (!secret || !signature) return false;

  const provided = signature.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = buildMetaSignature(secret, body);

  if (provided.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function extractMessageBody(message: Record<string, unknown>) {
  const text = message.text as { body?: string } | undefined;
  if (typeof text?.body === "string" && text.body.trim()) return text.body.trim();

  const interactive = message.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } } | undefined;
  if (typeof interactive?.button_reply?.title === "string" && interactive.button_reply.title.trim()) {
    return interactive.button_reply.title.trim();
  }
  if (typeof interactive?.list_reply?.title === "string" && interactive.list_reply.title.trim()) {
    return interactive.list_reply.title.trim();
  }

  const reaction = message.reaction as { emoji?: string } | undefined;
  if (typeof reaction?.emoji === "string" && reaction.emoji.trim()) return reaction.emoji.trim();

  return "Meta message received";
}

export function normalizeMetaPayload(payload: unknown): MetaMessageRecord[] {
  if (!payload || typeof payload !== "object") return [];

  const entry = Array.isArray((payload as { entry?: unknown[] }).entry) ? (payload as { entry: unknown[] }).entry : [];
  const messages: MetaMessageRecord[] = [];

  for (const item of entry) {
    if (!item || typeof item !== "object") continue;

    const changes = Array.isArray((item as { changes?: unknown[] }).changes) ? (item as { changes: unknown[] }).changes : [];

    for (const change of changes) {
      if (!change || typeof change !== "object") continue;

      const value = (change as { value?: Record<string, unknown> }).value ?? {};
      const metadata = (value.metadata as Record<string, unknown> | undefined) ?? {};
      const rawMessages = Array.isArray(value.messages) ? value.messages : [];
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];

      for (const message of rawMessages) {
        if (!message || typeof message !== "object") continue;

        const record = message as Record<string, unknown>;
        const from = String(record.from ?? "");
        const body = extractMessageBody(record);
        if (!from || !body) continue;

        const contact = contacts.find((entryContact) => {
          const contactRecord = entryContact as Record<string, unknown>;
          return String(contactRecord.wa_id ?? "") === from;
        }) as Record<string, unknown> | undefined;

        messages.push({
          id: String(record.id ?? `${from}-${record.timestamp ?? Date.now()}`),
          from,
          type: String(record.type ?? "text"),
          body,
          timestamp: String(record.timestamp ?? new Date().toISOString()),
          customerName: String((contact?.profile as { name?: string } | undefined)?.name ?? from),
          phoneNumberId: String((metadata.phone_number_id as string | undefined) ?? null),
          displayPhoneNumber: String((metadata.display_phone_number as string | undefined) ?? null),
        });
      }
    }
  }

  return messages;
}

type MetaMessageInsert = {
  message_id: string;
  thread_id: string;
  phone: string;
  customer_name: string;
  company_name: string | null;
  direction: "inbound" | "outbound";
  body: string;
  status: "received" | "sent" | "failed";
  source: "meta_whatsapp";
  raw_payload: Record<string, unknown> | null;
};

export async function saveMetaMessage(input: MetaMessageInsert) {
  if (!hasSupabaseConfig()) {
    return { ok: true, demo: true, saved: false };
  }

  try {
    const client = createSupabaseAdmin();
    const { error } = await client.from("meta_messages").upsert(
      {
        message_id: input.message_id,
        thread_id: input.thread_id,
        phone: input.phone,
        customer_name: input.customer_name,
        company_name: input.company_name,
        direction: input.direction,
        body: input.body,
        status: input.status,
        source: input.source,
        raw_payload: input.raw_payload,
      },
      { onConflict: "message_id" },
    );

    if (error) throw new Error(error.message);
    return { ok: true, demo: false, saved: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save Meta message.";
    return { ok: false, demo: false, saved: false, error: message };
  }
}

export async function saveInboundMetaMessage(message: MetaMessageRecord) {
  return saveMetaMessage({
    message_id: message.id,
    thread_id: message.from,
    phone: message.from,
    customer_name: message.customerName,
    company_name: null,
    direction: "inbound",
    body: message.body,
    status: "received",
    source: "meta_whatsapp",
    raw_payload: { from: message.from, type: message.type, timestamp: message.timestamp, phoneNumberId: message.phoneNumberId, displayPhoneNumber: message.displayPhoneNumber },
  });
}

export async function saveOutboundMetaMessage({
  to,
  body,
  messageId,
}: {
  to: string;
  body: string;
  messageId: string;
}) {
  return saveMetaMessage({
    message_id: messageId,
    thread_id: to,
    phone: to,
    customer_name: "CRM operator",
    company_name: null,
    direction: "outbound",
    body,
    status: "sent",
    source: "meta_whatsapp",
    raw_payload: { to, body },
  });
}

export async function sendMetaTextMessage({
  to,
  text,
  accessToken,
  phoneNumberId,
}: {
  to: string;
  text: string;
  accessToken?: string;
  phoneNumberId?: string;
}) {
  const token = accessToken ?? process.env.META_ACCESS_TOKEN;
  const numberId = phoneNumberId ?? process.env.META_PHONE_NUMBER_ID;

  if (!token || !numberId) {
    return {
      ok: true,
      demo: true,
      messageId: `demo-${Date.now()}`,
      note: "Meta credentials are not configured, so the message was queued in demo mode.",
    };
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${numberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
      preview_url: false,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "Unable to send Meta message.";
    return { ok: false, error: message };
  }

  const messageId = payload?.messages?.[0]?.id ?? `meta-${Date.now()}`;
  const saved = await saveOutboundMetaMessage({ to, body: text, messageId });

  if (!saved.ok && !saved.demo) {
    console.warn("Meta outbound message was sent but could not be stored in Supabase:", saved.error);
  }

  return {
    ok: true,
    messageId,
    demo: false,
  };
}

export async function listMetaThreads(): Promise<MetaConversationThread[]> {
  if (!hasSupabaseConfig()) {
    return demoMetaThreads;
  }

  try {
    const client = createSupabaseAdmin();
    const { data, error } = await client
      .from("meta_messages")
      .select("id,thread_id,phone,customer_name,company_name,body,direction,status,created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    const byThread = new Map<string, MetaConversationThread>();
    for (const row of data ?? []) {
      const threadId = String(row.thread_id ?? row.phone ?? row.id);
      const existing = byThread.get(threadId);
      const message = String(row.body ?? "") || "Meta message received";
      const updatedAt = row.created_at ? new Date(row.created_at).toLocaleString() : "Just now";
      const customer = String(row.customer_name ?? row.phone ?? "Unknown contact");
      const company = String(row.company_name ?? "Unknown company");
      const unread = row.direction === "inbound" ? 1 : 0;

      byThread.set(threadId, {
        id: row.id,
        customer,
        phone: String(row.phone ?? ""),
        company,
        status: existing?.status ?? (unread ? "New" : "Open"),
        unread: existing ? Math.max(existing.unread, unread) : unread,
        lastMessage: existing?.lastMessage ? existing.lastMessage : message,
        updatedAt: existing?.updatedAt ?? updatedAt,
      });
    }

    const threads = Array.from(byThread.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return threads.length ? threads : demoMetaThreads;
  } catch {
    return demoMetaThreads;
  }
}
