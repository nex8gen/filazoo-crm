"use client";

import { useRef, useState, useEffect } from "react";
import { portalWebsiteDocument, type PortalWebsite } from "@/lib/portal-website";

export function PortalWebsiteContent({ website, accent, title }: { website: PortalWebsite; accent: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    const resize = () => setHeight(Math.max(100, Math.min(12000, body.scrollHeight + 4)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(body);
    return () => observer.disconnect();
  }, [loaded]);
  return <iframe ref={frame} title={`${title} website content`} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={portalWebsiteDocument(website, accent)} onLoad={() => setLoaded(value => value + 1)} style={{ width: "100%", height, border: 0, borderRadius: 16, background: "white", display: "block" }} />;
}
