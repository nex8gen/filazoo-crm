"use client";

import { useState, useTransition } from "react";
import { Fingerprint } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loginDestination } from "@/lib/login-destination";
import { securityError } from "@/lib/account-security";
import { passkeyBrowserError } from "@/lib/passkey-config";
import { NotificationToast } from "@/components/ui/notification-toast";

export function PasskeySignIn({ next }: { next: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return <div className="mt-4 space-y-3"><button type="button" className="flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50" disabled={pending} onClick={() => {
    setError(""); startTransition(async () => {
      const unsupported = passkeyBrowserError({ origin: window.location.origin, secure: window.isSecureContext, supported: Boolean(window.PublicKeyCredential) });
      if (unsupported) { setError(unsupported); return; }
      try {
        const { data, error } = await createClient().auth.signInWithPasskey();
        if (error) { setError(securityError(error, "Unable to sign in with this passkey. Try again or use your password.")); return; }
        if (!data.session || !data.user) { setError("Unable to verify your passkey. Try signing in again."); return; }
        const destination = loginDestination(next);
        window.location.assign(data.user.factors?.some(factor => factor.status === "verified") ? `/auth/mfa?next=${encodeURIComponent(destination)}` : destination);
      } catch { setError("The passkey request could not be completed. Try again or use your password."); }
    });
  }}><Fingerprint aria-hidden="true" className="size-4" />{pending ? "Waiting for passkey…" : "Sign in with a passkey"}</button>{error ? <NotificationToast>{error}</NotificationToast> : null}</div>;
}
