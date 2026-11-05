import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getViewer } from "@/lib/auth";
import { SignupForm } from "./signup-form";
import { signupDestination } from "@/lib/signup";
import { getAuthProviders } from "@/lib/auth-providers";

export const metadata = { title: "Create account" };
export const instant = false;
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = signupDestination((await searchParams).next);
  if (await getViewer()) redirect(next);
  return <AuthShell step={1}><SignupForm next={next} providers={await getAuthProviders()} /></AuthShell>;
}
