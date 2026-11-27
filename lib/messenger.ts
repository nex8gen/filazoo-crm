import type { MetaConversationThread, MetaInboxData } from "./meta-messenger.ts";

export type MessengerThread = Omit<MetaConversationThread, "channel"> & {
  channel: MetaConversationThread["channel"] | "web";
  invoiceId?: string;
  companyId?: string | null;
  contextLabel?: string;
};
export type WebsiteInboxData = { threads: MessengerThread[]; connected: boolean };
export type MessengerInboxData = Omit<MetaInboxData, "threads" | "connection"> & {
  threads: MessengerThread[];
  connection: MetaInboxData["connection"] & { webConfigured: boolean };
  canReply: boolean;
  websiteError: string | null;
};
export type WebsiteMessageRow = {
  id: string; invoice_id: string; sender: "customer" | "staff"; body: string; created_at: string;
  invoice: { id: string; number: number; status: string; company_id: string | null; document: { customerName?: string; customerEmail?: string } } | null;
};

/** One thread per invoice: the portal session grants access to that invoice only. */
export function websiteMessageThreads(rows: WebsiteMessageRow[]): MessengerThread[] {
  const groups = new Map<string, WebsiteMessageRow[]>();
  for (const row of rows) {
    if (!row.invoice || row.invoice.id !== row.invoice_id || row.invoice.status === "draft") continue;
    const group = groups.get(row.invoice_id) ?? [];
    group.push(row); groups.set(row.invoice_id, group);
  }
  return [...groups.values()].map((group): MessengerThread => {
    const sorted = group.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const latest = sorted.at(-1)!;
    const invoice = latest.invoice!;
    const messages: MessengerThread["messages"] = sorted.map((row) => ({
      id: row.id, direction: row.sender === "customer" ? "inbound" : "outbound",
      body: row.body, type: "text", status: row.sender === "customer" ? "received" : "sent", createdAt: row.created_at,
    }));
    const lastStaffIndex = sorted.findLastIndex((row) => row.sender === "staff");
    const unread = sorted.slice(lastStaffIndex + 1).filter((row) => row.sender === "customer").length;
    return {
      id: "web:" + invoice.id, channel: "web", invoiceId: invoice.id, companyId: invoice.company_id,
      customer: invoice.document.customerName?.trim() || invoice.document.customerEmail || "Customer",
      customerId: invoice.document.customerEmail || invoice.id, pageId: invoice.id,
      contextLabel: "INV-" + String(invoice.number).padStart(6, "0"),
      status: unread > 0 ? "New" : "Open", unread, lastMessage: latest.body, updatedAt: latest.created_at,
      replyWindowOpen: true, replyWindowEndsAt: null, messages,
    };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Preserve read markers and a just-confirmed reply when an older poll finishes. */
export function mergeWebsiteThreads(current: MessengerThread[], incoming: MessengerThread[], readThrough: Record<string, string>) {
  const previous = new Map(current.filter((thread) => thread.channel === "web").map((thread) => [thread.id, thread]));
  const website = incoming.map((thread) => {
    const ids = new Set(thread.messages.map((message) => message.id));
    const confirmed = previous.get(thread.id)?.messages.filter((message) => message.direction === "outbound" && !ids.has(message.id) && Date.parse(message.createdAt) > Date.parse(thread.updatedAt)) ?? [];
    const messages = [...thread.messages, ...confirmed].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = messages.at(-1);
    const readAt = readThrough[thread.id];
    const unread = readAt ? messages.filter((message) => message.direction === "inbound" && Date.parse(message.createdAt) > Date.parse(readAt)).length : thread.unread;
    return { ...thread, messages, unread, status: unread > 0 ? "New" as const : "Open" as const,
      ...(latest ? { lastMessage: latest.body, updatedAt: latest.createdAt } : {}) };
  });
  return [...current.filter((thread) => thread.channel !== "web"), ...website].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

