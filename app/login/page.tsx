import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getViewer } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { safeInternalPath } from "@/lib/safe-redirect";
import { getAuthProviders } from "@/lib/auth-providers";

export const metadata: Metadata = { title: "Sign in" };
// Session validation is request-bound. Opt this auth route out of instant
// prerendering so Cache Components does not treat the blocking read as an error.
export const instant = false;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; message?: string }> }) {
  const [{ next, message }, viewer] = await Promise.all([searchParams, getViewer()]);
  if (viewer) redirect(safeInternalPath(next, "/workspaces"));
  return (
    <AuthShell><LoginForm next={safeInternalPath(next, "/workspaces")} message={message} providers={await getAuthProviders()} /></AuthShell>
  );
}
