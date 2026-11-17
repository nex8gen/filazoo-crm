"use client";

import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const client = () => true;
const server = () => false;

/** Keep the server and hydration render identical, then use the viewer's timezone. */
export function PortalLocalTime({ value, compact = false }: { value: string; compact?: boolean }) {
  const hydrated = useSyncExternalStore(subscribe, client, server);
  const options: Intl.DateTimeFormatOptions = compact ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" };
  return <time dateTime={value}>{new Date(value).toLocaleString(hydrated ? undefined : "en", { ...options, timeZone: hydrated ? undefined : "UTC" })}</time>;
}
