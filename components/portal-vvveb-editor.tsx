"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { LoaderCircle } from "lucide-react";
import { portalWebsiteBaseCss, sanitizePortalWebsite, type PortalWebsite } from "@/lib/portal-website";

export type PortalEditorCapture = () => Promise<PortalWebsite | null>;

/** The primary canvas; the Filazoo toolbar owns saving and publishing. */
export function PortalVvvebEditor({ initial, accent, title, captureRef, onDirty, onSaveRequest }: {
  initial: PortalWebsite; accent: string; title: string;
  captureRef: RefObject<PortalEditorCapture | null>; onDirty: () => void; onSaveRequest: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const dirty = useRef(false);
  const [startingWebsite] = useState(initial);
  const [startingAccent] = useState(accent);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const callbacks = useRef({ onDirty, onSaveRequest });
  useEffect(() => { callbacks.current = { onDirty, onSaveRequest }; }, [onDirty, onSaveRequest]);
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: "filazoo:brand", accent }, window.location.origin);
  }, [ready, accent]);
  useEffect(() => {
    const origin = window.location.origin;
    let loaded = false;
    let pending: { resolve: (website: PortalWebsite | null) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; requestId: string } | null = null;
    const timeout = setTimeout(() => setError("The website designer could not load. Refresh the page to try again."), 20000);
    const capture: PortalEditorCapture = () => {
      if (!dirty.current) return Promise.resolve(null);
      if (!loaded) return Promise.reject(new Error("Wait for the website designer to finish loading."));
      if (pending) return Promise.reject(new Error("Your layout is being captured. Please try again."));
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        pending = { resolve, reject, requestId, timer: setTimeout(() => { pending = null; reject(new Error("Unable to capture your layout. Try again.")); }, 5000) };
        frame.current?.contentWindow?.postMessage({ type: "filazoo:capture", requestId }, origin);
      });
    };
    captureRef.current = capture;
    function receive(event: MessageEvent) {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || !event.data) return;
      if (event.data.type === "filazoo:ready") frame.current?.contentWindow?.postMessage({ type: "filazoo:init", website: sanitizePortalWebsite(startingWebsite), css: portalWebsiteBaseCss, accent: startingAccent, dark: document.documentElement.classList.contains("dark") }, origin);
      if (event.data.type === "filazoo:loaded") { loaded = true; clearTimeout(timeout); setReady(true); setError(""); }
      if (event.data.type === "filazoo:dirty") { dirty.current = true; callbacks.current.onDirty(); }
      if (event.data.type === "filazoo:apply-request") callbacks.current.onSaveRequest();
      if (event.data.type === "filazoo:error") { clearTimeout(timeout); setError("The website designer encountered an error. Refresh the page to try again."); }
      if (event.data.type === "filazoo:result" && pending && event.data.requestId === pending.requestId) {
        const request = pending; pending = null; clearTimeout(request.timer);
        const website = event.data.website;
        if (typeof website?.html !== "string" || typeof website?.css !== "string" || website.html.length > 60000 || website.css.length > 20000) {
          request.reject(new Error("This layout is too large. Remove a few sections and try again.")); return;
        }
        dirty.current = false;
        request.resolve(sanitizePortalWebsite(website));
      }
    }
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timeout); window.removeEventListener("message", receive);
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error("The website designer was closed before capturing changes.")); }
      if (captureRef.current === capture) captureRef.current = null;
    };
  }, [startingWebsite, startingAccent, captureRef]);
  return <div className="pb-vvveb-inline" aria-label={`${title} website designer`}>
    {error && <p className="pb-vvveb-error" role="alert">{error}</p>}
    {!ready && !error && <p role="status" className="pb-vvveb-loading"><LoaderCircle className="animate-spin" />Loading website designer…</p>}
    <iframe ref={frame} src="/vendor/vvveb/editor.html?v=2" title="Drag-and-drop website designer" className="pb-vvveb-frame" referrerPolicy="no-referrer" />
  </div>;
}
