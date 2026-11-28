import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";

export const metadata = { title: "WeChat sign-in" };
export default function WechatErrorPage() {
  return <AuthShell><AuthHeading title="WeChat sign-in did not finish">The QR code may have expired, or authorization was cancelled. Try again or sign in with email.</AuthHeading><Link className="mt-6 inline-block underline" href="/login">Back to sign in</Link></AuthShell>;
}
