/** Only direct requests to prepare an invoice need the Chat -> Agent handoff. */
export function isInvoiceCreationRequest(text: string) {
  const request = text.trim();
  if (/^(?:don't|do not|never|how|explain|example|hypothetical)\b/i.test(request) || /^(?:请)?(?:不要|别|不需要|如何|怎么|怎样|示例|举例)/.test(request)) return false;
  if (/^(?:请|帮我|可以|能否|能不能|我想|我要)?[\s\S]{0,12}(?:创建|开具|生成|制作)[\s\S]{0,40}发票/.test(request)) return true;
  return /^(?:(?:can|could|would|will)\s+(?:you\s+)?|(?:i\s+(?:want|need|would like)\s+(?:you\s+)?to\s+)|(?:please\s+)|(?:help\s+me\s+))?(?:please\s+)?(?:create|make|prepare|draft)\s+(?:(?:a|an|the|draft|new|proforma|pro forma|sales|tax)\s+)*(?:invoice|invoices|invioce|inovice)\b/i.test(request);
}
