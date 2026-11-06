export const requestContextInstruction = [
  "REQUEST CONTEXT PRIORITY: An explicitly named subject, company, contact, document/reference, resource, or requested task takes priority over the open page. The page is context, not a restriction on where you can answer or work.",
  "When the request has no specific subject, use the active page and its selected record: 'summarize this' on Analytics means the visible analytics; 'reply' in Email means the selected email; 'create an invoice for this customer' means the selected company. Do not choose another recent record or a record from an unrelated earlier task.",
  "When the user names another target, look up that target using authorized CRM reads, even from an unrelated page. Do not reuse the open customer's identity, prices, recipient, email thread, address or document for that different target. Resolve missing IDs from saved records; ask only if the intended record or required business choice remains ambiguous.",
  "An answer to your own pending clarification continues that task and its established target. Honor the latest explicit correction. A change of page alone does not authorize a new action or broaden the user's requested changes.",
  "An explicit general-knowledge question is its own subject: answer it directly instead of refusing because the current page is unrelated. Ground CRM-specific claims in verified records; distinguish general explanations and estimates from saved CRM facts. External research must use actual supplied web evidence.",
  "Chat can perform authorized read-only CRM lookups to answer questions from any page. Agent can prepare supported creation and update actions from any page. The existing permissions, validation and action review still apply. Never require navigating to another page just to name the target of a supported task.",
].join("\n");

type Choice = { id: string; name: string };
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function requestContextSelection(text: string, pageCompanyId?: string | null, choices: Choice[] = []) {
  const message = ` ${normalize(text)} `;
  const named = [...new Map(choices.filter(choice => {
    const name = normalize(choice.name);
    return name && !["company", "customer", "custom", "test", "new"].includes(name) && message.includes(` ${name} `);
  }).map(choice => [choice.id, choice])).values()];
  const explicitParty = ( /\b(?:company|customer|contact|recipient)\s+(?:named|called)\s+["“']?([\p{L}][\p{L}\p{N} .&'-]{1,100})/iu.exec(text)?.[1]
    ?? /\b(?:send|email|message|draft|write)\b.{0,100}\bto\s+["“']?([\p{L}][\p{L}\p{N} .&'-]{1,100})/iu.exec(text)?.[1]
    ?? /\baddress\b.{0,40}\bfor\s+["“']?([\p{L}][\p{L}\p{N} .&'-]{1,100})/iu.exec(text)?.[1])?.trim();
  const anotherParty = explicitParty && !/^(?:this|that|the|our|my|your|me|it|them|current|selected|existing|same|invoice|quotation|catalog|shipping|billing|free)\b/i.test(explicitParty);
  const usePageCompany = named.length ? named.length === 1 && named[0].id === pageCompanyId : !anotherParty;
  return { defaultSubject: usePageCompany ? "active page and selected record" : "explicit user target; look up its own records", usePageCompany, namedCompanies: named };
}
