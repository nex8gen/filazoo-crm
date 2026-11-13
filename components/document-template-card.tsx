"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Mail, Star } from "lucide-react";
import { renderEmailDesign, type EmailDesign } from "@/lib/email-design";
import type { LibraryDocument } from "@/lib/documents";
import { isBuiltinEmailTemplate } from "@/lib/documents";

export function DocumentTemplateCard({ document, workspaceName, selected, onPreview, onStar, children }: {
  document: LibraryDocument; workspaceName: string; selected: boolean;
  onPreview: () => void; onStar: () => void; children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<{ design: EmailDesign | null; error: boolean } | null>(null);
  const design = document.email_design ?? loaded?.design;
  const needsDesign = !!document.design_version && !document.email_design && !document.preview_url;
  const html = useMemo(() => design ? renderEmailDesign(design, { preview: true }).html : null, [design]);

  useEffect(() => {
    if (!card.current || !needsDesign) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [needsDesign]);

  useEffect(() => {
    if (!visible || !needsDesign) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${document.id}?details=1`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error("Unable to load preview.");
        if (!controller.signal.aborted) setLoaded({ design: result.document.email_design ?? null, error: !result.document.email_design });
      } catch {
        if (!controller.signal.aborted) setLoaded({ design: null, error: true });
      }
    })();
    return () => controller.abort();
  }, [document.id, needsDesign, visible]);

  return <div ref={card} className={`library-template-card${selected ? " is-selected" : ""}`}>
    <button type="button" className="library-template-select" aria-label={`Preview ${document.name}`} aria-pressed={selected} onClick={onPreview}>
      <span className="library-template-thumbnail" aria-hidden="true">
        <span className="library-template-canvas">
          {document.preview_url ? <iframe title={`${document.name} thumbnail`} sandbox="allow-same-origin" loading="lazy" tabIndex={-1} referrerPolicy="no-referrer" src={document.preview_url} /> : html ? <iframe title={`${document.name} thumbnail`} sandbox="allow-same-origin" loading="lazy" tabIndex={-1} referrerPolicy="no-referrer" srcDoc={html} /> : needsDesign && !loaded ? <span className="library-template-loading"><Loader2 /></span> : <span className="library-template-text"><Mail /><strong>{document.subject || document.name}</strong><span>{document.body}</span>{loaded?.error ? <small>Preview unavailable</small> : null}</span>}
        </span>
      </span>
      <span className="library-template-info"><strong title={document.name}>{document.name}</strong><span title={document.company || workspaceName}>By {document.company || workspaceName}</span></span>
    </button>
    {!isBuiltinEmailTemplate(document) ? <button type="button" className={`library-star library-template-star${document.starred ? " is-starred" : ""}`} aria-label={`${document.starred ? "Unstar" : "Star"} ${document.name}`} aria-pressed={document.starred} onClick={onStar}><Star /></button> : null}
    <div className="library-template-actions">{children}</div>
  </div>;
}
