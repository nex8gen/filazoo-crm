"use client";

import { isValidElement, useEffect, useId, useLayoutEffect, useState, useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";

type NotificationTone = "error" | "warning" | "success" | "message";
type NotificationProps = HTMLAttributes<HTMLDivElement> & { tone?: NotificationTone; preserve?: boolean };

// State-driven notices may be mounted by several visible surfaces (for example
// an inbox and a composer). Share plain notices until their last owner clears.
// Actionable notices keep independent stores so callbacks cannot cross forms.
const sharedNotices = new Map<string, { id: string; owners: Set<string> }>();
let sharedNoticeSequence = 0;

function notificationText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(notificationText).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return notificationText(node.props.children);
  return "";
}

function hasControls(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasControls);
  if (!isValidElement<{ children?: ReactNode; onClick?: unknown; href?: unknown }>(node)) return false;
  return Boolean(node.props.onClick || node.props.href || node.type === "button" || hasControls(node.props.children));
}

function createContentStore(initial: ReactNode) {
  let content = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => content,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(next: ReactNode) {
      if (Object.is(content, next)) return;
      content = next;
      listeners.forEach(listener => listener());
    },
  };
}

function NotificationContent({ store }: { store: ReturnType<typeof createContentStore> }) {
  const content = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return <div data-notification-content>{content}</div>;
}

/** Present state-driven notices in the app's shared toast host, without an inline banner. */
export function NotificationToast({ children, tone = "error", preserve, id }: NotificationProps) {
  const instanceId = useId();
  const toastId = `notification-${instanceId}`;
  const [store] = useState(() => createContentStore(children));
  const message = notificationText(children).replace(/\s+/g, " ").trim();
  const interactive = hasControls(children);
  const persistent = preserve ?? interactive;

  // Update retry controls and callbacks without restarting the notification timer
  // when an unrelated field or pending state changes.
  useLayoutEffect(() => { store.update(children); }, [children, store]);

  useEffect(() => {
    if (!message) return;
    const key = interactive ? null : JSON.stringify([tone, message, persistent]);
    const existing = key ? sharedNotices.get(key) : undefined;
    const shared = existing ?? { id: key ? `notification-shared-${++sharedNoticeSequence}` : toastId, owners: new Set<string>() };
    shared.owners.add(toastId);
    if (key) sharedNotices.set(key, shared);
    if (!existing) {
      // A shared notice must not follow the first owner's store when that owner
      // changes messages while another surface still owns the original notice.
      const contentStore = key ? createContentStore(store.getSnapshot()) : store;
      toast[tone](<NotificationContent store={contentStore} />, { id: shared.id, duration: persistent ? Infinity : 3000 });
    }
    return () => {
      shared.owners.delete(toastId);
      if (shared.owners.size) return;
      if (key) sharedNotices.delete(key);
      toast.dismiss(shared.id);
    };
  }, [interactive, message, persistent, store, toastId, tone]);

  // Preserve field descriptions that point to an error's original element ID.
  return id && message ? <span id={id} className="sr-only">{message}</span> : null;
}
