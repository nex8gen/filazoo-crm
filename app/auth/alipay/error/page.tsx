import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";

export const metadata = { title: "Alipay sign-in" };
export default function AlipayErrorPage() {
  return <AuthShell><AuthHeading title="Alipay sign-in did not finish">Your authorization may have expired, or Alipay has not activated sign-in for this app yet. Please try again or sign in with email.</AuthHeading><Link className="mt-6 inline-block underline" href="/login">Back to sign in</Link></AuthShell>;
}
