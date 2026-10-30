import mime from "libmime";

/** Decode RFC 2047 words and RFC 2231 continued/extended parameters from BODYSTRUCTURE. */
export function emailMimeParameter(params: Record<string, string> | undefined, name: string) {
  if (!params) return undefined;
  const entries = Object.entries(params).filter(([key]) => key.toLowerCase() === name || key.toLowerCase().startsWith(name + "*"));
  if (!entries.length) return undefined;
  const header = "attachment; " + entries.map(([key, value]) => `${key.toLowerCase()}="${String(value).replace(/[\r\n]/g, "").replace(/["\\]/g, "\\$&")}"`).join("; ");
  try { const value = mime.parseHeaderValue(header).params[name]; return value ? decodeEmailFilename(value) : undefined; }
  catch { return params[name] ? decodeEmailFilename(params[name]) : undefined; }
}
export function decodeEmailFilename(value: string) {
  try { return mime.decodeWords(value); } catch { return value; }
}
