"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emailDraftSchema, type EmailDraft } from "@/lib/email-workbench";

type LocalDraft = { key: string; owner: string; draft: EmailDraft; deleted?: boolean; synced?: boolean };
let database: Promise<IDBDatabase> | undefined;
function draftDatabase() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("filazoo-email-drafts-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
async function storeLocal(record: LocalDraft) {
  const db = await draftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    transaction.objectStore("drafts").put(record);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
}
export function mailDraftKey(mailboxId: string, thread: string) {
  // Bound long References while keeping a readable, stable thread-scoped key.
  let hash = 2166136261;
  for (const character of thread) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `reply:${mailboxId}:${(hash >>> 0).toString(16)}:${thread.slice(-320)}`;
}

export function useMailDrafts(owner: string, mailboxId: string | null) {
  const [drafts, setDrafts] = useState<Record<string, EmailDraft>>({});
  const records = useRef<Record<string, EmailDraft>>({});
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading drafts…");
  const pending = useRef(new Map<string, LocalDraft>());
  const saving = useRef(false);
  const mounted = useRef(true);
  const save = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      for (const [id, record] of pending.current) {
        const response = await fetch("/api/email/drafts", { method: record.deleted ? "DELETE" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record.draft) });
        const result = await response.json();
        if (!response.ok || result.saved === false) throw new Error(result.error || "A newer draft exists. Reopen Drafts before continuing.");
        if (pending.current.get(id) === record) { pending.current.delete(id); await storeLocal({ ...record, synced: true }); }
      }
      if (mounted.current) setStatus(pending.current.size ? "Saving draft…" : "Draft saved");
    } catch (error) { if (mounted.current) setStatus(error instanceof Error ? error.message : "Server save failed. Draft retained on this device."); }
    finally { saving.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (async () => {
      const local = await draftDatabase().then((db) => new Promise<LocalDraft[]>((resolve, reject) => {
        const request = db.transaction("drafts").objectStore("drafts").getAll();
        request.onsuccess = () => resolve(request.result.filter((record: LocalDraft) => record.owner === owner && record.draft.mailboxId === mailboxId));
        request.onerror = () => reject(request.error);
      })).catch(() => []);
      let remote: EmailDraft[] = [];
      let remoteLoaded = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(`/api/email/drafts?mailboxId=${encodeURIComponent(mailboxId || "")}`, { cache: "no-store", signal: controller.signal }).finally(() => clearTimeout(timer));
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        remote = result.drafts.map((value: unknown) => emailDraftSchema.parse(value));
        remoteLoaded = true;
      } catch { if (!cancelled) setStatus("Using device drafts. Server connection will retry."); }
      if (cancelled) return;
      const next = Object.fromEntries(remote.map((draft) => [draft.id, draft]));
      for (const record of local) {
        if (remoteLoaded && record.synced && !next[record.draft.id]) continue;
        if ((next[record.draft.id]?.revision || 0) > record.draft.revision) continue;
        if (record.deleted) delete next[record.draft.id]; else next[record.draft.id] = record.draft;
        if (!record.synced) pending.current.set(record.draft.id, record);
      }
      records.current = next; setDrafts(next); setReady(true);
      void save();
    })();
    const timer = window.setInterval(() => { void save(); }, 2000);
    const preventLoss = (event: BeforeUnloadEvent) => { if (pending.current.size) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", preventLoss);
    return () => { cancelled = true; mounted.current = false; clearInterval(timer); window.removeEventListener("beforeunload", preventLoss); void save(); };
  }, [owner, mailboxId, save]);

  const put = useCallback((value: EmailDraft) => {
    const previous = records.current[value.id];
    const comparable = (draft: EmailDraft) => JSON.stringify({ ...draft, revision: 0 });
    if (previous && comparable(previous) === comparable(value)) return;
    const draft = { ...value, revision: Math.max(Date.now() * 1000, (previous?.revision || 0) + 1) };
    const record = { key: `${owner}:${draft.id}`, owner, draft };
    records.current = { ...records.current, [draft.id]: draft };
    pending.current.set(draft.id, record);
    setDrafts(records.current); setStatus("Saving draft…");
    void storeLocal(record).catch(() => setStatus("Device storage failed. Keep this page open until the server saves your draft."));
  }, [owner]);
  const remove = useCallback((draft: EmailDraft) => {
    const record: LocalDraft = { key: `${owner}:${draft.id}`, owner, draft: { ...draft, revision: Date.now() * 1000 }, deleted: true };
    const next = { ...records.current }; delete next[draft.id]; records.current = next;
    pending.current.set(draft.id, record); setDrafts(next);
    void storeLocal(record).then(save).catch(() => setStatus("Unable to remove the device draft. Retry before leaving."));
  }, [owner, save]);
  return { drafts, get: (id: string) => records.current[id], put, remove, ready, status, retry: save };
}
