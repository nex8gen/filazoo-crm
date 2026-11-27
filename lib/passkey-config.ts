// Must match Supabase Auth's WebAuthn origin. Keep this stable after enrollment.
export const passkeyOrigin = process.env.NEXT_PUBLIC_PASSKEY_ORIGIN || "https://crm.filazoosupply.com";

export function passkeyBrowserError(context: { origin: string; secure: boolean; supported: boolean }) {
  if (context.origin !== passkeyOrigin) return `Passkeys are available at ${passkeyOrigin}. Open that address to add or use a passkey.`;
  if (!context.secure || !context.supported) return "This browser does not support passkeys. Use a supported browser over HTTPS.";
  return null;
}
