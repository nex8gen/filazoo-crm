import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getViewer } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
// Session validation is request-bound. Opt this auth route out of instant
// prerendering so Cache Components does not treat the blocking read as an error.
export const instant = false;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; message?: string }> }) {
  const [{ next, message }, viewer] = await Promise.all([searchParams, getViewer()]);
  if (viewer) redirect("/");
  return (
    <AuthShell><LoginForm next={next} message={message} /></AuthShell>
  );
}
