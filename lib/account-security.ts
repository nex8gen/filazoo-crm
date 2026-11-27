export type DeviceSession = {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_active_at: string;
  current: boolean;
};

export function formatSecurityDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

export function describeDevice(agent: string | null) {
  if (!agent) return { name: "Unknown device", kind: "desktop" as const };
  const os = /iPad/.test(agent) ? "iPad" : /iPhone/.test(agent) ? "iPhone" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Macintosh|Mac OS X/.test(agent) ? "Mac" : /Linux/.test(agent) ? "Linux" : "Unknown device";
  const browser = /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera" : /Firefox\/|FxiOS\//.test(agent) ? "Firefox" : /Chrome\/|CriOS\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "";
  return { name: browser ? `${browser} on ${os}` : os, kind: /iPhone|iPad|Android/.test(os) ? "mobile" as const : "desktop" as const };
}

export function securityError(error: unknown, fallback: string) {
  const value = error as { code?: string; status?: number; name?: string } | null;
  if (value?.code === "passkey_disabled") return "Passkeys are not enabled for this service yet. Try another sign-in method.";
  if (value?.name === "NotAllowedError" || value?.code === "webauthn_user_cancelled") return "The passkey request was cancelled or timed out. Try again when you are ready.";
  if (value?.code === "webauthn_credential_exists") return "This passkey is already registered.";
  if (value?.status === 429 || value?.code === "over_request_rate_limit") return "Too many attempts. Wait a moment before trying again.";
  if (value?.code === "mfa_verification_failed" || value?.code === "mfa_challenge_expired") return "That code is invalid or expired. Enter a new code from your authenticator app.";
  return fallback;
}
