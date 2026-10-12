"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Mail, MessageSquareText, Phone, Radio, SendHorizonal, UserRound, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import type { MetaInboxData, MetaThreadMessage } from "@/lib/meta-messenger";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function MessengerInbox({ data }: { data: MetaInboxData }) {
  const [threads, setThreads] = useState(data.threads);
  const [selectedId, setSelectedId] = useState(data.threads[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? threads[0],
    [selectedId, threads],
  );
  const replyWindowOpen = selectedThread?.replyWindowOpen ?? false;

  async function handleSend() {
    const message = draft.trim();
    if (!selectedThread || !message || !replyWindowOpen) return;
    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/meta/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selectedThread.customerId, message }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Messenger reply could not be sent.");

      const sent: MetaThreadMessage = {
        id: result?.messageId || `local-${Date.now()}`,
        direction: "outbound",
        body: message,
        type: "text",
        status: "sent",
        createdAt: result?.createdAt || new Date().toISOString(),
      };
      setThreads((current) => current.map((thread) => thread.id === selectedThread.id
        ? { ...thread, messages: [...thread.messages, sent], lastMessage: message, updatedAt: sent.createdAt, status: "Open" }
        : thread));
      setSuccess(result?.saved === false ? "Reply sent to Facebook; database storage needs attention." : "Reply sent through Facebook Messenger.");
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Messenger reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facebook Messenger"
        description="Receive conversations from click-to-Messenger ads, reply from Filazoo, and review Facebook Lead Ads."
      />

      <Card className="shadow-none">
        <CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center">
          <div className="flex items-start gap-3">
            {data.connection.configured ? <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" /> : <XCircle className="mt-0.5 size-5 text-amber-600" />}
            <div className="min-w-0">
              <p className="font-medium">{data.connection.configured ? `Connected to ${data.connection.pageName || "Facebook Page"}` : "Facebook Page connection incomplete"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Webhook: <span className="break-all font-mono">{data.connection.callbackUrl}</span>
              </p>
              {data.connection.missing.length > 0 ? <p className="mt-2 text-xs text-amber-700">Missing: {data.connection.missing.join(", ")}</p> : null}
              {data.connection.error ? <p className="mt-2 text-xs text-destructive">Meta check failed: {data.connection.error}</p> : null}
              {data.dataError ? <p className="mt-2 text-xs text-destructive">Database: {data.dataError}</p> : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">{data.connection.graphApiVersion}</Badge>
            <Badge variant={data.connection.configured ? "secondary" : "outline"}>{data.connection.configured ? "Live" : "Setup required"}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="shadow-none">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><MessageSquareText className="size-4" />Page inbox</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-3 pt-0">
            {threads.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No Messenger conversations received yet. Send a test message to the connected Facebook Page after subscribing the Page webhook.</p>
            ) : threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => { setSelectedId(thread.id); setError(null); setSuccess(null); }}
                className={`w-full rounded-lg border p-3 text-left transition ${selectedThread?.id === thread.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate font-medium">{thread.customer}</p><p className="truncate text-xs text-muted-foreground">Messenger ID {thread.customerId}</p></div>
                  {thread.unread > 0 ? <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">{thread.unread}</span> : null}
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{thread.lastMessage}</p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{thread.status}</span><span>{formatDate(thread.updatedAt)}</span></div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          {selectedThread ? (
            <>
              <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div><CardTitle className="text-base">{selectedThread.customer}</CardTitle><p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><UserRound className="size-3.5" />PSID {selectedThread.customerId}</p></div>
                <Badge variant={replyWindowOpen ? "secondary" : "outline"}><Clock3 />{replyWindowOpen ? `Reply by ${formatDate(selectedThread.replyWindowEndsAt!)}` : "24-hour reply window closed"}</Badge>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1">
                  {selectedThread.messages.map((message) => (
                    <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-xl border p-3 text-sm ${message.direction === "outbound" ? "border-primary/30 bg-primary/5" : "bg-muted/30"}`}>
                        <p>{message.body}</p><p className="mt-1 text-[10px] text-muted-foreground">{formatDate(message.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 rounded-xl border bg-background p-3">
                  <label htmlFor="messenger-reply" className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Reply</label>
                  <textarea id="messenger-reply" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a Facebook Messenger reply..." disabled={!replyWindowOpen} className="min-h-[110px] w-full resize-none rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60" />
                  {!replyWindowOpen ? <p className="text-xs text-amber-700">The customer must interact with your Page again before a normal Messenger reply can be sent.</p> : null}
                  {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                  {success ? <p role="status" className="text-sm text-emerald-600">{success}</p> : null}
                  <div className="flex justify-end"><Button type="button" onClick={handleSend} disabled={sending || !draft.trim() || !replyWindowOpen}><SendHorizonal />{sending ? "Sending..." : "Send reply"}</Button></div>
                </div>
              </CardContent>
            </>
          ) : <CardContent className="p-6 text-sm text-muted-foreground">Select a conversation after the first Messenger webhook arrives.</CardContent>}
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Radio className="size-4" />Facebook Lead Ads</CardTitle></CardHeader>
        <CardContent>
          {data.leads.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No Lead Ad forms received yet. Subscribe the Page webhook to the <span className="font-mono">leadgen</span> field and create a test lead.</p> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.leads.map((lead) => (
                <div key={lead.id} className="rounded-lg border p-4">
                  <p className="font-medium">{lead.name}</p>
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {lead.email ? <p className="flex items-center gap-2"><Mail className="size-3.5" />{lead.email}</p> : null}
                    {lead.phone ? <p className="flex items-center gap-2"><Phone className="size-3.5" />{lead.phone}</p> : null}
                    <p>{formatDate(lead.createdAt)}</p>
                    {lead.adId ? <p>Ad ID: {lead.adId}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Lead form submissions can be followed up by email or phone. A Messenger reply is available only when that person also opens a conversation with your Page.</p>
        </CardContent>
      </Card>
    </div>
  );
}
