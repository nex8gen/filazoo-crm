import { z } from "zod";

export type EmailAddress = { address: string; name?: string };

/** Plain address lists are deliberately unambiguous in editable recipient fields. */
export function emailAddresses(value: string | string[] | null | undefined): string[] {
  const entries = (Array.isArray(value) ? value : [value || ""]).flatMap((entry) => entry.split(/[;,\n]/));
  return [...new Set(entries.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

export const recipientListSchema = z.union([z.string(), z.array(z.string())]).transform(emailAddresses)
  .pipe(z.array(z.email()).max(50));

export function replyRecipients(message: { direction: string; contact: string; from?: string; replyTo?: string | null; to?: EmailAddress[]; cc?: EmailAddress[] }, ownAddresses: string[], all = false) {
  const own = new Set(emailAddresses(ownAddresses));
  const primary = emailAddresses(message.direction === "outbound" ? message.to?.map((item) => item.address) || message.contact : message.replyTo || message.from || message.contact);
  const to = primary.filter((address) => !own.has(address));
  const additional = all ? emailAddresses([...(message.to || []).map((item) => item.address), ...(message.cc || []).map((item) => item.address)]) : [];
  const cc = additional.filter((address) => !own.has(address) && !to.includes(address));
  return { to, cc };
}

export function emailSubject(subject: string, mode: "reply" | "forward") {
  return `${mode === "reply" ? "Re" : "Fwd"}: ${subject.replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)+/i, "")}`;
}
