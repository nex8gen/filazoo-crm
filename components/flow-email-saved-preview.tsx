"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderEmailDesign, newEmailDesign, type EmailDesign } from "@/lib/email-design";
import { flowEmailContent } from "@/lib/flow-email-editor";
import { renderFlowTemplate } from "@/lib/flow-templates";
import type { JsonConfig } from "@/lib/flows";

export function FlowEmailSavedPreview({ config, device }: { config: JsonConfig; device: "desktop" | "mobile" }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(414);
  const [height, setHeight] = useState(900);
  const frameWidth = device === "mobile" ? 375 : 600;
  const scale = Math.min(1, width / frameWidth);
  const content = flowEmailContent(config);
  const design = config.emailDesign as EmailDesign | undefined;
  const preheader = String(config.preheader || "");
  const html = useMemo(() => renderEmailDesign(design ?? newEmailDesign(content.body, "text"), { preview: true, viewport: device, preheader, personalize: value => renderFlowTemplate(value, { name: "Alex", email: "alex@example.com" }) }).html, [design, content.body, device, preheader]);
  useLayoutEffect(() => {
    const element = container.current; if (!element) return;
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} className="wf-email-saved-preview" data-device={device}><div style={{ width: frameWidth * scale, height: height * scale, position: "relative", marginInline: "auto" }}><iframe title={`${device === "mobile" ? "Mobile" : "Desktop"} workflow email preview`} sandbox="allow-same-origin" srcDoc={html} style={{ width: frameWidth, height, transform: `scale(${scale})`, transformOrigin: "top left" }} onLoad={event => { const body = event.currentTarget.contentDocument?.body; if (body) setHeight(Math.max(500, Math.min(12000, body.scrollHeight + 24))); }} /></div></div>;
}
