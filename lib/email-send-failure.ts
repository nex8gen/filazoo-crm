/** Only positive evidence that SMTP never reached message submission permits a retry. */
export function emailFailedBeforeSubmission(error: unknown) {
  const value = typeof error === "object" && error !== null ? error as { message?: unknown; command?: unknown } : null;
  const message = typeof error === "string" ? error : typeof value?.message === "string" ? value.message : "";
  // Also recognizes the exact error retained by older delivery records.
  if (message === "Client network socket disconnected before secure TLS connection was established") return true;
  const command = typeof value?.command === "string" ? value.command.toUpperCase() : "";
  if (/^(?:EHLO|HELO|STARTTLS|AUTH(?: .+)?|MAIL FROM|RCPT TO)$/.test(command)) return true;
  // Nodemailer also labels disconnects *after* DATA as CONN. Never trust CONN alone.
  return command === "CONN" && /^(?:getaddrinfo (?:ENOTFOUND|EAI_AGAIN)\b|connect (?:ECONNREFUSED|ENETUNREACH|EHOSTUNREACH)\b|Greeting never received$|Connection timeout$)/.test(message);
}
