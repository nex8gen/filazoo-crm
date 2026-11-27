import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { readAccountSecurity } from "@/lib/account-security-server";
import { safeInternalPath } from "@/lib/safe-redirect";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-step verification" };
export const instant = false;

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safeInternalPath(next);
  const security = await readAccountSecurity().catch(() => null);
  if (!security) redirect("/login");
  if (!security.requiresMfa) redirect(destination.startsWith("/auth/") || destination.startsWith("/login") ? "/" : destination);
  const { data, error } = await security.client.auth.mfa.listFactors();
  return <AuthShell><MfaForm next={destination} factors={data?.totp ?? []} error={error ? "Unable to load your authenticators. Refresh to try again." : undefined} /></AuthShell>;
}
