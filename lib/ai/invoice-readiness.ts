/** Narrow shortcut for an unsupplied address/cost, without interrupting searches or customer outreach. */
export function invoiceReadinessQuestion(text: string, fields: Record<string, string> | undefined, language = "en") {
  if (!fields || !/\b(?:add|include|use)\b/i.test(text) || !/\baddress\b/i.test(text)
    || /\b(?:email|history|search|check|find|reply|send|ask|confirm)\b/i.test(text) || /\d/.test(text)
    || text.trim().split(/\s+/).length > 25) return null;
  const billing = /\bbilling\b/i.test(text) && !/\bshipping\b/i.test(text);
  if (fields[billing ? "commerce.address" : "commerce.shippingAddress"]?.trim()) return null;
  const cost = /\b(?:shipping|delivery|freight)\s*(?:cost|charge|fee)?\b/i.test(text);
  return language === "zh-CN"
    ? `该客户没有保存${billing ? "账单" : "收货"}地址。请提供完整地址，或让我检查客户邮件记录。${cost ? "运费是多少？也可以明确指定包邮。" : ""}`
    : `${fields.name || "This customer"} has no saved ${billing ? "billing" : "shipping"} address. What is the full address, or should I check the customer's email history?${cost ? " What shipping charge should I use? Please explicitly confirm if shipping is free." : ""}`;
}
