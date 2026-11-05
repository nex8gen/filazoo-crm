/** Keep login tokens, invitation keys, customer keys and CRM searches out of telemetry. */
export function monitoringUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname
    .replace(/(\/customer\/)[^/]+/g, "$1[redacted]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]");
  return url.toString();
}
