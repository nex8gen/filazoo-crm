export function assistantProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/credit card|billing|insufficient credits|payment required/i.test(message)) return "The optional AI Gateway fallback is unavailable because billing is not enabled. You can keep using the existing Gemini connection on the published app.";
  if (/authentication failed|invalid.*(?:api key|token)|unauthorized|expired.*token/i.test(message)) return "AI provider authentication failed. An administrator must refresh the Vercel development token or configure a valid AI Gateway API key.";
  if (/location is not supported|unsupported (?:user )?location|region is not supported/i.test(message)) return "Gemini is unavailable in this server's location. Configure AI Gateway or run the app in a supported region.";
  return "Filazoo AI could not respond. Please retry or ask an administrator to check the AI provider.";
}
