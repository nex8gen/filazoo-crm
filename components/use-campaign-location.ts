"use client";

import { useSyncExternalStore } from "react";
import { campaignEditorLocation, campaignEditorSearch } from "@/lib/campaign-editor-session";

const event = "campaign-editor-location";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(event, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(event, listener); };
}
const snapshot = () => window.location.search;
const serverSnapshot = () => "";

export function useCampaignLocation() {
  return campaignEditorLocation(useSyncExternalStore(subscribe, snapshot, serverSnapshot));
}

export function navigateCampaign(value: Parameters<typeof campaignEditorSearch>[1], replace = false) {
  const search = campaignEditorSearch(window.location.search, value);
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new Event(event));
}
