export type CitationSource = { id: string; label: string; url?: string; recordedAt?: string };

export function citationUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, "");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(?:^|\.)(?:localhost|local|localdomain|internal|lan|onion|test|invalid|example|home\.arpa)$/.test(host)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function sourceDomain(source: CitationSource) {
  const url = citationUrl(source.url);
  if (!url) return undefined;
  const host = new URL(url).hostname.replace(/^www\./, "");
  // Google's grounding redirect is a citation link, not the publisher's brand.
  if (host === "vertexaisearch.cloud.google.com" && /^[a-z\d.-]+\.[a-z]{2,}$/i.test(source.label.trim())) return source.label.trim().replace(/^www\./, "");
  return host;
}

export function citationParts(text: string, sources: CitationSource[]) {
  const byId = new Map(sources.filter(source => !source.url || citationUrl(source.url)).map(source => [source.id, source]));
  const parts: Array<{ text: string; source?: never } | { source: CitationSource; text?: never }> = [];
  let previous = 0;
  for (const match of text.matchAll(/\[(W\d+|A\d+|P|C)\]/g)) {
    const source = byId.get(match[1]);
    if (!source) continue;
    if (match.index! > previous) parts.push({ text: text.slice(previous, match.index) });
    parts.push({ source }); previous = match.index! + match[0].length;
  }
  if (previous < text.length) parts.push({ text: text.slice(previous) });
  return parts;
}
