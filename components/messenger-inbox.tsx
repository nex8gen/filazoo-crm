"use client";

import { useMemo, useState } from "react";
import { MessageSquareText, SendHorizonal, Phone, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import type { MetaConversationThread } from "@/lib/meta-messenger";

export function MessengerInbox({ threads }: { threads: MetaConversationThread[] }) {
  const [selectedPhone, setSelectedPhone] = useState(threads[0]?.phone ?? "");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.phone === selectedPhone) ?? threads[0],
    [selectedPhone, threads],
  );

  async function handleSend() {
    if (!selectedThread || !draft.trim()) return;

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/meta/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selectedThread.phone, message: draft.trim() }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Message could not be sent.");
      }

      setSuccess(result?.demo ? "Demo message queued locally." : "Meta message sent successfully.");
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meta Messenger"
        description="Monitor WhatsApp conversations, reply directly from the CRM, and route the next action to the right deal."
        actions={
          <Button variant="outline" className="gap-2">
            <Sparkles className="size-4" />
            Connect Meta
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageSquareText className="size-4" />
              Inbox
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 pt-0">
            {threads.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No messages yet. Connect your Meta WhatsApp number to start receiving inbound conversations.
              </p>
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedPhone(thread.phone)}
                  className={`w-full rounded-lg border p-3 text-left transition ${selectedThread?.phone === thread.phone ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{thread.customer}</p>
                      <p className="text-xs text-muted-foreground">{thread.company}</p>
                    </div>
                    {thread.unread > 0 ? (
                      <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                        {thread.unread}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{thread.lastMessage}</p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{thread.status}</span>
                    <span>{thread.updatedAt}</span>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          {selectedThread ? (
            <>
              <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">{selectedThread.customer}</CardTitle>
                  <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="size-3.5" />
                    {selectedThread.phone}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    {selectedThread.status}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <UserRound className="size-3.5" />
                    {selectedThread.company}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 p-4">
                <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Hello, we need a quote for your PETG material with a 2-week delivery window. Can you confirm the MOQ and lead time?
                </div>

                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
                  Hi {selectedThread.customer.split(" ")[0] || "there"}, thanks for reaching out. We can supply PETG in your required volumes with a lead time of 10 business days. I can send a catalog and pricing summary right away.
                </div>

                <div className="space-y-2 rounded-xl border bg-background p-3">
                  <label className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Reply</label>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Type your response here..."
                    className="min-h-[120px] w-full resize-none rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />

                  {error ? <p className="text-sm text-red-600">{error}</p> : null}
                  {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

                  <div className="flex justify-end">
                    <Button type="button" onClick={handleSend} disabled={sending || !draft.trim()} className="gap-2">
                      <SendHorizonal className="size-4" />
                      {sending ? "Sending..." : "Send reply"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent className="p-6 text-sm text-muted-foreground">Select a conversation to view the message history.</CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
