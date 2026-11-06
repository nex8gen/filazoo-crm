import type { ResearchIdentity } from "./customer-research.ts";

export type WebSearchPreference = "auto" | "on" | "off";
/** An explicit off choice wins over automatic research intent. */
export function webSearchForRequest(preference: WebSearchPreference, text: string) {
  if (preference === "off") return false;
  if (/\b(?:do not|don't|dont|without|no)\s+(?:use\s+)?(?:web\s*search|google|online research)|\boffline only\b|\bonly (?:use )?(?:saved|crm|internal) (?:records|data)\b/i.test(text)) return false;
  if (preference === "on") return true;
  const request = text.trim().replace(/^(?:(?:please|can you|could you|would you|will you)\s+)+/i, "");
  if (/^research\s+(?:(?:my|our|the|unpaid|overdue|outstanding|saved|recent)\s+)*(?:invoices?|orders?|payments?|analytics|sales|crm|emails?)\b/i.test(request)) return false;
  return /^(?:research|reasearch|reserch)\s+(?!my\s|our\s|(?:the\s+)?(?:invoices?|orders?|payments?|analytics|sales|crm|emails?)\b)/i.test(request)
    || /\b(?:search|look|find|research)\b.{0,70}\b(?:google|online|on the web|on the internet|public (?:company )?(?:information|details))\b/i.test(request)
    || /\b(?:search (?:google|online|the web|the internet)|look up .+ online)\b/i.test(request);
}

type Choice = { id: string; name: string; city?: string | null; country?: string | null; website?: string | null; email?: string | null; contacts?: Array<{ email?: string | null }> };
type Current = { id?: string; fields: ResearchIdentity };
type Target = { identity: ResearchIdentity; companyId?: string; question?: never } | { question: string; identity?: never; companyId?: never };
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const mentioned = (text: string, name: string) => Boolean(normalized(name)) && ` ${normalized(text)} `.includes(` ${normalized(name)} `);
const emailIn = (text: string, email?: string | null) => Boolean(email && (text.match(/[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? []).some(value => value.toLowerCase() === email.trim().toLowerCase()));
function explicitName(text: string) {
  const value = /(?:^|\b)(?:research|reasearch|reserch|look up|find (?:public )?(?:information|details) (?:about|on)|search (?:online |google |the web )?(?:for|about))\s+(?:the company\s+|company\s+)?(.+?)(?:[.!?]\s*$|$)/i.exec(text)?.[1]
    ?.replace(/\s+(?:again|online|on the web|on google|please)\s*$/ig, "").replace(/^["“']|["”']$/g, "").trim();
  const subject = value?.replace(/^(?:more\s+)?(?:about|on)\s+/i, "").trim();
  if (!subject || subject.length > 160) return undefined;
  // Page references remain references even when preceded by "about" or "information".
  if (/\b(?:this|that|these|our|my|above|selected|current)\b/i.test(subject)
    || (/\b(?:company|customer|business|it|them)\b/i.test(subject) && /^(?:the|it|them|company|customer|business)\b/i.test(subject))) return undefined;
  return subject;
}
/** Resolve from authorized server-side choices, never from a model-generated ID. */
export function companyResearchTarget({ messages, currentCompany, choices = [] }: { messages: Array<{ role: string; content: string }>; currentCompany?: Current | null; choices?: Choice[] }): Target {
  const requests = messages.filter(message => message.role === "user").slice(-3).map(message => message.content);
  for (let index = requests.length - 1; index >= 0; index--) {
    const request = requests[index];
    const matches = choices.filter(choice => mentioned(request, choice.name) || emailIn(request, choice.email) || choice.contacts?.some(contact => emailIn(request, contact.email)));
    const unique = [...new Map(matches.map(choice => [choice.id, choice])).values()];
    const cities = unique.filter(choice => choice.city && mentioned(request, choice.city));
    const located = unique.length > 1 ? cities.length ? cities : unique.filter(choice => choice.country && mentioned(request, choice.country)) : unique;
    const currentLocationMatches = !located.length || (currentCompany?.fields.city && mentioned(request, currentCompany.fields.city)) || (currentCompany?.fields.country && mentioned(request, currentCompany.fields.country));
    if (currentCompany?.fields.name && currentLocationMatches && (mentioned(request, currentCompany.fields.name) || emailIn(request, currentCompany.fields.email)) && matches.every(choice => normalized(choice.name) === normalized(currentCompany.fields.name!))) return { identity: currentCompany.fields, companyId: currentCompany.id };
    if (located.length === 1) {
      const choice = located[0];
      const email = choice.email || choice.contacts?.find(contact => emailIn(request, contact.email))?.email || choice.contacts?.find(contact => contact.email)?.email;
      return { companyId: choice.id, identity: { name: choice.name, city: choice.city ?? undefined, country: choice.country ?? undefined, website: choice.website ?? undefined, ...(email ? { email } : {}) } };
    }
    if (unique.length > 1) return { question: `Which company should I research: ${unique.slice(0, 5).map(choice => `${choice.name}${choice.city ? ` (${choice.city})` : ""}`).join("; ")}?` };
    const name = explicitName(request);
    if (name) return { identity: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name) ? { email: name } : { name } };
    if (index === requests.length - 1 && currentCompany?.fields.name) return { identity: currentCompany.fields, companyId: currentCompany.id };
  }
  return { question: "Which company should I research? Enter its name or public website." };
}
