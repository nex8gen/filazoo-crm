/** Public URL validation shared by browser lead forms and server research. */
export function publicResearchUrl(value: string | undefined) {
  if (!value?.trim() || value.length > 2_000) return undefined;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return undefined;
    // Exclude IP literals and internal names, including numeric IPv4 forms normalized by URL.
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|localdomain|internal|lan|onion|test|invalid|example|home\.arpa)$/.test(host)) return undefined;
    url.hash = '';
    return url.href;
  } catch { return undefined; }
}
