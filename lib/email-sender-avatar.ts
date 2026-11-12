import { parse } from "tldts";
import { companyPortrait } from "./company-avatar.ts";

type Sender = { email: string; name?: string; companyId?: string | null };
type SenderAvatar = { kind: "company" | "brand" | "initials"; src?: string; initials: string };

// A mailbox provider's logo is not the personal sender's profile photo.
const personalMailboxDomains = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.jp", "ymail.com", "rocketmail.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me",
  "mail.com", "gmx.com", "gmx.de", "qq.com", "foxmail.com", "163.com", "126.com", "yeah.net",
]);
const providerServiceDomains = new Set(["qiye.163.com"]);

export function emailSenderAvatar({ email, name, companyId }: Sender): SenderAvatar {
  const address = (email.match(/<([^<>]+)>/)?.[1] || email).trim().toLowerCase();
  const label = name?.trim() && !name.includes("@") ? name.trim() : address.split("@")[0];
  const words = label.split(/[\s._+-]+/).filter(Boolean);
  const initials = (words.length > 1 ? words.slice(0, 2).map(word => Array.from(word)[0]).join("") : Array.from(words[0] || "?").slice(0, 2).join("")).toUpperCase();
  if (companyId) return { kind: "company", src: companyPortrait(companyId), initials };

  const rawDomain = address.match(/^[^\s@<>]+@([^\s@<>/:?#\\]+)$/)?.[1];
  if (!rawDomain) return { kind: "initials", initials };
  let hostname: string;
  try { hostname = new URL(`https://${rawDomain}`).hostname.replace(/\.$/, ""); }
  catch { return { kind: "initials", initials }; }
  const result = parse(hostname, { allowPrivateDomains: true });
  const domain = result.domain;
  if (!domain || result.isIp || (!result.isIcann && !result.isPrivate)
    || (personalMailboxDomains.has(domain) && !providerServiceDomains.has(hostname))) return { kind: "initials", initials };

  // Only the public sender domain is sent to the favicon service, never the email address.
  return { kind: "brand", src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, initials };
}
