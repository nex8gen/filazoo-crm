/** Split recognizable quoted history without discarding the original body. */
export function splitQuotedEmail(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const boundary = lines.findIndex((line, index) => index > 0 && (
    /^\s*On\s.+wrote:\s*$/i.test(line)
    || /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)
    || (/^\s*>/.test(line) && lines.slice(0, index).some((value) => value.trim()))
  ));
  if (boundary < 0) return { current: body, quoted: null };
  const current = lines.slice(0, boundary).join("\n").trim();
  if (!current) return { current: body, quoted: null };
  return { current, quoted: lines.slice(boundary).join("\n") };
}
