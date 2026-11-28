import type { ResearchIdentity } from "./customer-research.ts";

export type WebSearchPreference = "auto" | "on" | "off";
/** An explicit off choice wins over automatic research intent. */
export function webSearchForRequest(preference: WebSearchPreference, text: string) {
  if (preference === "off") return false;
  if (/\b(?:do not|don't|dont|without|no)\s+(?:use\s+)?(?:web\s*search|google|online research)|\boffline only\b|\bonly (?:use )?(?:saved|crm|internal) (?:records|data)\b/i.test(text)) return false;
  if (/(?:不要|不使用|禁止)(?:联网|网络搜索|搜索网页)|仅(?:使用)?(?:已保存|内部|CRM)(?:记录|数据)/i.test(text)) return false;
  if (preference === "on") return true;
  const request = text.trim().replace(/^(?:(?:please|can you|could you|would you|will you)\s+)+/i, "");
  if (/^research\s+(?:(?:my|our|the|unpaid|overdue|outstanding|saved|recent)\s+)*(?:invoices?|orders?|payments?|analytics|sales|crm|emails?)\b/i.test(request)) return false;
  return /^(?:research|reasearch|reserch)\s+(?!my\s|our\s|(?:the\s+)?(?:invoices?|orders?|payments?|analytics|sales|crm|emails?)\b)/i.test(request)
    || /\b(?:search|look|find|research)\b.{0,70}\b(?:google|online|on the web|on the internet|public (?:company )?(?:information|details))\b/i.test(request)
    || /\b(?:search (?:google|online|the web|the internet)|look up .+ online)\b/i.test(request)
    || /^(?:(?:请|帮我|请帮我|麻烦|可以|能否)\s*)*(?:背调|研究|调查|调研|查一下|了解一下)/.test(request);
}

type Choice = { id: string; name: string; city?: string | null; country?: string | null; website?: string | null; email?: string | null; contacts?: Array<{ email?: string | null }> };
type Current = { id?: string; fields: ResearchIdentity };
type Target = { identity: ResearchIdentity; companyId?: string; question?: never } | { question: string; identity?: never; companyId?: never };
type ResearchRequest = { messages: Array<{ role: string; content: string }>; currentCompany?: Current | null; choices?: Choice[] };
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const mentioned = (text: string, name: string) => Boolean(normalized(name)) && (/\p{Script=Han}/u.test(name) ? normalized(text).includes(normalized(name)) : ` ${normalized(text)} `.includes(` ${normalized(name)} `));
const emailIn = (text: string, email?: string | null) => Boolean(email && (text.match(/[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? []).some(value => value.toLowerCase() === email.trim().toLowerCase()));
function explicitName(text: string) {
  const value = (/^(?:(?:请|帮我|请帮我|麻烦|可以|能否)\s*)*(?:背调|研究|调查|调研|查一下|了解一下)\s*(.+?)[。！？!?]*$/.exec(text)?.[1]
    ?? /(?:^|\b)(?:research|reasearch|reserch|look up|find (?:public )?(?:information|details) (?:about|on)|search (?:online |google |the web )?(?:for|about))\s+(?:the company\s+|company\s+)?(.+?)(?:[.!?]\s*$|$)/i.exec(text)?.[1])
    ?.replace(/\s+(?:again|online|on the web|on google|please)\s*$/ig, "").replace(/^["“']|["”']$/g, "").trim();
  const subject = value?.replace(/^(?:more\s+)?(?:about|on)\s+/i, "").trim();
  if (!subject || subject.length > 160) return undefined;
  // Page references remain references even when preceded by "about" or "information".
  if (/^(?:这|那|该|当前|选中|上面|我们|我的)/.test(subject) || /^(?:公司|客户|企业|它)$/.test(subject)
    || /\b(?:this|that|these|our|my|above|selected|current)\b/i.test(subject)
    || (/\b(?:company|customer|business|it|them)\b/i.test(subject) && /^(?:the|it|them|company|customer|business)\b/i.test(subject))) return undefined;
  return subject;
}
/** Web-search permission is not an instruction to research a company on every turn. */
export function companyResearchForRequest(input: ResearchRequest): Target | undefined {
  const latest = input.messages.at(-1)?.content.trim() ?? "";
  const researchIntent = (text: string) => /\b(?:research|reasearch|reserch|look up|find (?:public )?(?:information|details) (?:about|on)|search (?:online |google |the web )?(?:for|about))\b/i.test(text)
    || /\b(?:analy[sz]e|analsye)\b.{0,50}\b(?:company|customer|business)\b/i.test(text)
    || /^(?:(?:请|帮我|请帮我|麻烦|可以|能否)\s*)*(?:背调|研究|调查|调研|查一下|了解一下)/.test(text);
  const continuation = /^(?:try again|retry|continue|research (?:it|them|again)|再试一次|重试|继续|继续背调)[.!?。！？]*$/i.test(latest);
  if (continuation) {
    const previous = input.messages.filter(message => message.role === "user").slice(0, -1).at(-1)?.content;
    return previous && researchIntent(previous) ? companyResearchTarget(input) : undefined;
  }
  if (researchIntent(latest)) return companyResearchTarget({ ...input, messages: explicitName(latest) ? input.messages.slice(-1) : input.messages });
  const clarification = input.messages.at(-2);
  const answeringCompanyQuestion = clarification?.role === "assistant"
    && /^(?:Which company should I research|您想研究哪家公司)/.test(clarification.content)
    && latest.length > 0 && latest.length <= 160 && !/[\r\n?!？]/.test(latest)
    && !/^(?:(?:give|tell|show|explain|what|how|why|can|please)\b|介绍|解释|给我|告诉我)/i.test(latest);
  if (answeringCompanyQuestion) return companyResearchTarget({ ...input, messages: [{ role: "user", content: `Research ${latest}` }] });
  return undefined;
}
/** Resolve from authorized server-side choices, never from a model-generated ID. */
export function companyResearchTarget({ messages, currentCompany, choices = [] }: ResearchRequest): Target {
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
