export function isSampleEmailSubject(subject: string | null | undefined) {
  return /\[sample\]/i.test(subject ?? "");
}
