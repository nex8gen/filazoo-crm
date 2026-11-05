import { z } from "zod";
import { passwordSchema } from "./password.ts";
import { safeInternalPath } from "./safe-redirect.ts";

export const signupSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name.").max(40),
  lastName: z.string().trim().min(1, "Enter your last name.").max(40),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: passwordSchema,
  terms: z.literal("on", { error: "Accept the Terms of Service and Privacy Policy to continue." }),
});

// Auth screens are not valid post-auth destinations: they can create loops.
export function signupDestination(value: unknown) {
  const path = safeInternalPath(value, "/workspaces/new");
  return /^\/(?:login|signup|auth|forgot-password|update-password)(?:[/?#]|$)/.test(path) ? "/workspaces/new" : path;
}

export const pendingSignupCookie = "filazoo-pending-signup";
export const pendingSignupOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/signup", maxAge: 3600 };

export function readPendingSignup(value: string | undefined): { email: string; next: string } | null {
  try {
    const parsed = z.object({ email: z.string().email(), next: z.string() }).safeParse(JSON.parse(value || ""));
    return parsed.success ? { email: parsed.data.email, next: signupDestination(parsed.data.next) } : null;
  } catch { return null; }
}
