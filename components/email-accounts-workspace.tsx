"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { EmailInboxWorkspace } from "@/components/email-inbox";
import type { EmailInboxBackendData, InboxEmailItem } from "@/lib/email-inbox";

type Props = {
  initialData: EmailInboxBackendData;
} & Omit<ComponentProps<typeof EmailInboxWorkspace>,
  "mailboxes" | "selectedMailboxId" | "defaultSenderId" | "initialEmails" |
  "mailboxConfigured" | "sendConfigured" | "inboxConfigured" | "inboxError" |
  "aiConfigured" | "defaultMailboxEmail" | "dataMode" | "initialAutomation" |
  "assignedCustomersOnly" | "onMailboxChange" | "onMailboxSnapshot" | "switchingMailboxId" | "mailboxSwitchError">;

export function EmailAccountsWorkspace({ initialData, ...props }: Props) {
  const [data, setData] = useState(initialData);
  const [switchingMailboxId, setSwitchingMailboxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSwitched, setHasSwitched] = useState(false);
  const current = useRef(initialData);
  const snapshots = useRef(new Map([[initialData.selectedMailboxId, initialData]]));
  const loads = useRef(new Map<string, { controller: AbortController; promise: Promise<EmailInboxBackendData> }>());
  const navigation = useRef(0);

  const loadMailbox = useCallback((mailboxId: string) => {
    const pending = loads.current.get(mailboxId);
    if (pending && !pending.controller.signal.aborted) return pending.promise;
    const controller = new AbortController();
    // Older browsers support AbortController but not AbortSignal.any/timeout.
    const timeout = setTimeout(() => controller.abort(new DOMException("Mailbox request timed out. Please try again.", "TimeoutError")), 30_000);
    const promise = (async () => {
      try {
        const response = await fetch(`/api/email/inbox?mailboxId=${encodeURIComponent(mailboxId)}&refresh=false`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const next = await response.json();
        if (controller.signal.aborted) throw new DOMException("Mailbox request cancelled", "AbortError");
        if (!response.ok || !Array.isArray(next.emails) || next.selectedMailboxId !== mailboxId) {
          throw new Error(next.error || "Unable to switch mailboxes. Please try again.");
        }
        snapshots.current.set(mailboxId, next);
        return next as EmailInboxBackendData;
      } finally {
        clearTimeout(timeout);
        if (loads.current.get(mailboxId)?.controller === controller) loads.current.delete(mailboxId);
      }
    })();
    loads.current.set(mailboxId, { controller, promise });
    return promise;
  }, []);

  const switchMailbox = useCallback(async (mailboxId: string, pushHistory = true) => {
    const sequence = ++navigation.current;
    setError(null);
    setSwitchingMailboxId(null);
    if (mailboxId === current.current.selectedMailboxId) return;

    const install = (next: EmailInboxBackendData) => {
      current.current = next;
      snapshots.current.set(mailboxId, next);
      setData(next);
      setHasSwitched(true);
      if (pushHistory) window.history.pushState(null, "", `/emails?mailbox=${encodeURIComponent(mailboxId)}`);
    };
    const cached = snapshots.current.get(mailboxId);
    if (cached) {
      install(cached);
      return; // The newly mounted inbox revalidates this snapshot immediately.
    }

    setSwitchingMailboxId(mailboxId);
    try {
      const next = await loadMailbox(mailboxId);
      if (navigation.current !== sequence) return;
      install(next);
    } catch (reason) {
      if (navigation.current !== sequence) return;
      setError(reason instanceof Error ? reason.message : "Unable to switch mailboxes. Please try again.");
      if (!pushHistory && current.current.selectedMailboxId) {
        window.history.replaceState(null, "", `/emails?mailbox=${encodeURIComponent(current.current.selectedMailboxId)}`);
      }
    } finally {
      if (navigation.current === sequence) setSwitchingMailboxId(null);
    }
  }, [loadMailbox]);

  const rememberSnapshot = useCallback((mailboxId: string | null, emails: InboxEmailItem[]) => {
    const saved = snapshots.current.get(mailboxId);
    if (saved) snapshots.current.set(mailboxId, { ...saved, emails });
  }, []);

  const cancelLoads = useCallback(() => {
    navigation.current++;
    for (const pending of loads.current.values()) pending.controller.abort();
  }, []);

  useEffect(() => {
    // Warm the other authorized account while the user reads the current one.
    // These requests only read saved data; provider sync stays on the active view.
    for (const mailbox of initialData.mailboxes) {
      if (!snapshots.current.has(mailbox.id)) void loadMailbox(mailbox.id).catch(() => undefined);
    }
    const onBack = () => {
      if (window.location.pathname !== "/emails") return;
      const mailboxId = new URLSearchParams(window.location.search).get("mailbox") ?? initialData.defaultSenderId;
      if (mailboxId) void switchMailbox(mailboxId, false);
    };
    window.addEventListener("popstate", onBack);
    return () => {
      cancelLoads();
      window.removeEventListener("popstate", onBack);
    };
  }, [initialData.defaultSenderId, initialData.mailboxes, loadMailbox, switchMailbox, cancelLoads]);

  return <EmailInboxWorkspace
    {...props}
    initialThreadId={hasSwitched ? undefined : props.initialThreadId}
    initialAgentDraft={hasSwitched ? undefined : props.initialAgentDraft}
    key={data.selectedMailboxId ?? "no-mailbox"}
    mailboxes={data.mailboxes}
    selectedMailboxId={data.selectedMailboxId}
    defaultSenderId={data.defaultSenderId}
    initialEmails={data.emails}
    mailboxConfigured={data.mailboxConfigured}
    sendConfigured={data.sendConfigured}
    inboxConfigured={data.inboxConfigured}
    inboxError={data.inboxError}
    aiConfigured={data.aiConfigured}
    defaultMailboxEmail={data.defaultMailboxEmail}
    dataMode={data.mode}
    initialAutomation={data.automation}
    assignedCustomersOnly={data.assignedCustomersOnly}
    onMailboxChange={(id) => void switchMailbox(id)}
    onMailboxSnapshot={rememberSnapshot}
    switchingMailboxId={switchingMailboxId}
    mailboxSwitchError={error}
  />;
}
