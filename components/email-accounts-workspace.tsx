"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { EmailInboxWorkspace } from "@/components/email-inbox";
import type { EmailInboxBackendData, InboxEmailItem } from "@/lib/email-inbox";
import type { Product, Catalog } from "@/lib/types";
import { createPageCache } from "@/lib/page-cache";
import { emailPageKey, type EmailPageSnapshot } from "@/lib/email-pagination";

type Props = {
  initialData: EmailInboxBackendData;
  resourcesDeferred?: boolean;
} & Omit<ComponentProps<typeof EmailInboxWorkspace>,
  "mailboxes" | "selectedMailboxId" | "defaultSenderId" | "initialEmails" |
  "mailboxConfigured" | "sendConfigured" | "inboxConfigured" | "inboxError" |
  "aiConfigured" | "defaultMailboxEmail" | "dataMode" | "initialAutomation" |
  "assignedCustomersOnly" | "mailboxReadFailed" | "mailboxSnapshotPartial" | "loadResources" | "onMailboxChange" | "onMailboxSnapshot" | "switchingMailboxId" | "mailboxSwitchError">;

export function EmailAccountsWorkspace({ initialData, resourcesDeferred = false, ...props }: Props) {
  const [data, setData] = useState(initialData);
  const [pageCaches, setPageCaches] = useState(() => new Map<string | null, ReturnType<typeof createPageCache<EmailPageSnapshot>>>(initialData.pagination ? [[initialData.selectedMailboxId, createPageCache(emailPageKey(initialData.selectedMailboxId, initialData.pagination.request), { emails: initialData.emails, pagination: initialData.pagination })]] : []));
  const [switchingMailboxId, setSwitchingMailboxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSwitched, setHasSwitched] = useState(false);
  const current = useRef(initialData);
  const snapshots = useRef(new Map([[initialData.selectedMailboxId, initialData]]));
  const loads = useRef(new Map<string, { controller: AbortController; promise: Promise<EmailInboxBackendData> }>());
  const navigation = useRef(0);
  const resourcesRequest = useRef<Promise<{ products: Product[]; catalogs: Catalog[] }> | null>(null);
  const loadResources = useCallback(() => {
    if (!resourcesRequest.current) resourcesRequest.current = fetch("/api/email/resources", { cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.products) || !Array.isArray(result.catalogs)) throw new Error(result.error || "Unable to load the product catalog. Please retry.");
      return result;
    }).catch(error => { resourcesRequest.current = null; throw error; });
    return resourcesRequest.current;
  }, []);

  const loadMailbox = useCallback((mailboxId: string) => {
    const pending = loads.current.get(mailboxId);
    if (pending && !pending.controller.signal.aborted) return pending.promise;
    const controller = new AbortController();
    // Older browsers support AbortController but not AbortSignal.any/timeout.
    const timeout = setTimeout(() => controller.abort(new DOMException("Mailbox request timed out. Please try again.", "TimeoutError")), 30_000);
    const promise = (async () => {
      try {
        const response = await fetch(`/api/email/inbox?mailboxId=${encodeURIComponent(mailboxId)}&refresh=false&paged=true`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const next = await response.json();
        if (controller.signal.aborted) throw new DOMException("Mailbox request cancelled", "AbortError");
        if (!response.ok || next.mailboxReadFailed || !Array.isArray(next.emails) || next.selectedMailboxId !== mailboxId) {
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
      if (next.pagination) {
        const initialPage = next.pagination;
        setPageCaches(current => current.has(mailboxId) ? current : new Map([...current, [mailboxId, createPageCache(emailPageKey(mailboxId, initialPage.request), { emails: next.emails, pagination: initialPage })]]));
      }
      current.current = next;
      snapshots.current.set(mailboxId, next);
      setData(next);
      setHasSwitched(true);
      if (pushHistory) window.history.pushState(null, "", `/email?mailbox=${encodeURIComponent(mailboxId)}`);
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
        window.history.replaceState(null, "", `/email?mailbox=${encodeURIComponent(current.current.selectedMailboxId)}`);
      }
    } finally {
      if (navigation.current === sequence) setSwitchingMailboxId(null);
    }
  }, [loadMailbox]);

  const rememberSnapshot = useCallback((mailboxId: string | null, emails: InboxEmailItem[], readFailed?: boolean, partial?: boolean, pagination?: EmailInboxBackendData["pagination"]) => {
    const saved = snapshots.current.get(mailboxId);
    if (saved) snapshots.current.set(mailboxId, { ...saved, emails,
      mailboxReadFailed: readFailed ?? saved.mailboxReadFailed,
      mailboxSnapshotPartial: partial ?? saved.mailboxSnapshotPartial,
      inboxError: readFailed === false && saved.mailboxReadFailed ? null : saved.inboxError,
      pagination: pagination ?? saved.pagination,
    });
  }, []);

  const cancelLoads = useCallback(() => {
    navigation.current++;
    for (const pending of loads.current.values()) pending.controller.abort();
  }, []);

  useEffect(() => {
    // Accounts and their pages load on demand, after the user selects them.
    const onBack = () => {
      if (window.location.pathname !== "/email") return;
      const mailboxId = new URLSearchParams(window.location.search).get("mailbox") ?? initialData.defaultSenderId;
      if (mailboxId) void switchMailbox(mailboxId, false);
    };
    window.addEventListener("popstate", onBack);
    return () => {
      cancelLoads();
      window.removeEventListener("popstate", onBack);
    };
  }, [initialData.defaultSenderId, initialData.mailboxes, initialData.mailboxSnapshotPartial, initialData.mailboxReadFailed, loadMailbox, switchMailbox, cancelLoads]);

  return <EmailInboxWorkspace
    {...props}
    initialThreadId={hasSwitched ? undefined : props.initialThreadId}
    initialReplyOpen={!hasSwitched && props.initialReplyOpen}
    initialAgentDraft={hasSwitched ? undefined : props.initialAgentDraft}
    initialLibraryItem={hasSwitched ? undefined : props.initialLibraryItem}
    initialLibraryRequest={hasSwitched ? undefined : props.initialLibraryRequest}
    key={data.selectedMailboxId ?? "no-mailbox"}
    mailboxes={data.mailboxes}
    selectedMailboxId={data.selectedMailboxId}
    defaultSenderId={data.defaultSenderId}
    initialEmails={data.emails}
    initialPage={data.pagination}
    pageCache={pageCaches.get(data.selectedMailboxId)}
    mailboxConfigured={data.mailboxConfigured}
    sendConfigured={data.sendConfigured}
    inboxConfigured={data.inboxConfigured}
    inboxError={data.inboxError}
    mailboxReadFailed={data.mailboxReadFailed}
    mailboxSnapshotPartial={data.mailboxSnapshotPartial}
    loadResources={resourcesDeferred ? loadResources : undefined}
    lastMailboxSync={data.lastMailboxSync}
    syncHealth={data.syncHealth}
    providerFolders={data.providerFolders}
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
