"use client";

import { useMemo } from "react";
import { Streamdown, type Components } from "streamdown";
import { SourceCitedText } from "@/components/ui/customer-research";
import { assistantHref, responseMarkdown } from "@/lib/ai/response-markdown";
import type { CitationSource } from "@/lib/ai/source-citations";

const emptySources: CitationSource[] = [];

export function AiMarkdown({ text, sources = emptySources, streaming = false }: { text: string; sources?: CitationSource[]; streaming?: boolean }) {
  const markdown = useMemo(() => responseMarkdown(text, sources), [text, sources]);
  const components = useMemo<Components>(() => ({
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    a: ({ href, children }) => {
      const sourceId = href?.startsWith("#filazoo-source-") ? href.slice("#filazoo-source-".length) : undefined;
      const source = sources.find(item => item.id === sourceId);
      if (source) return <SourceCitedText text={`[${source.id}]`} sources={[source]} />;
      const safeHref = href ? assistantHref(href) : undefined;
      if (!safeHref) return <span>{children}</span>;
      const external = safeHref.startsWith("http");
      return <a href={safeHref} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>;
    },
  }), [sources]);
  return <Streamdown className="ai-markdown" mode={streaming ? "streaming" : "static"} isAnimating={streaming} components={components} skipHtml disallowedElements={["img", "iframe", "script", "style", "form", "input", "button"]} urlTransform={url => assistantHref(url) ?? ""} controls={false}>{markdown}</Streamdown>;
}
