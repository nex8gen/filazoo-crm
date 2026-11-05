export function assistantProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof Error && error.name === "AiBudgetError") return message;
  if (/AbortError|TimeoutError/.test(error instanceof Error ? error.name : "") || /timed?\s*out|timeout/i.test(message)) return "AI took too long to respond. Check History for the request status before retrying an action.";
  if (/credits or spending budget|insufficient.funds|quota_for_entity_exceeded/i.test(message)) return "AI Gateway credits or spending budget are exhausted. An administrator can add credits or review the budget in Vercel.";
  if (/AI Gateway access is blocked/i.test(message)) return "AI Gateway needs payment verification or permission to use this model. Check the AI Gateway settings in Vercel.";
  if (/AI Gateway is busy/i.test(message)) return "AI is temporarily busy. Please try again shortly.";
  if (/incomplete response|empty response/i.test(message)) return "AI returned an incomplete response. No actions from it were prepared. Please retry with a smaller task.";
  if (/credit card|billing|insufficient credits|payment required/i.test(message)) return "The optional AI Gateway fallback is unavailable because billing is not enabled. You can keep using the existing Gemini connection on the published app.";
  if (/authentication failed|invalid.*(?:api key|token)|unauthorized|expired.*token/i.test(message)) return "AI provider authentication failed. An administrator must refresh the Vercel development token or configure a valid AI Gateway API key.";
  if (/location is not supported|unsupported (?:user )?location|region is not supported/i.test(message)) return "Gemini is unavailable in this server's location. Configure AI Gateway or run the app in a supported region.";
  return "Filazoo AI could not respond. Please retry or ask an administrator to check the AI provider.";
}
