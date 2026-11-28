import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { AccountSetupProgress } from "@/components/account-setup-progress";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AuthGradient } from "@/components/ui/auth-gradient";
import styles from "./auth-section-1.module.css";

// Shared frame adapted from the supplied AuthSectionOne design. Forms remain
// separate so account, recovery, invitation and onboarding actions stay native.
export default function AuthSectionOne({ children, footer, step, variant }: { children: ReactNode; footer?: string; step?: 1 | 2 | 3; variant?: "signin" | "signup" }) {
  const isSignIn = variant === "signin";
  const isSignUp = variant === "signup";
  const isCompact = isSignIn || isSignUp;
  return (
    <main className={`${styles.brand} ${isSignIn ? styles.signin : isSignUp ? styles.signup : ""} min-h-svh bg-[var(--workspace-frame)] p-3 text-black antialiased dark:text-white`}>
      <div className={`${isCompact ? styles.frame : ""} grid min-h-[calc(100svh-1.5rem)] gap-3 lg:grid-cols-[0.94fr_1.06fr]`}>
        <section className={`${isSignIn ? styles.panel : isSignUp ? styles.signupPanel : ""} flex min-w-0 flex-col rounded-md bg-background px-6 py-7 sm:px-10 lg:px-12 xl:px-20`}>
          <header className={`flex items-center gap-4 ${isSignIn ? "justify-end" : "justify-between"}`}>
            {!isSignIn ? <Link href="/login" aria-label="NewAI sign in" className="flex items-center gap-2.5 font-semibold tracking-tight"><BrandMark className="h-auto w-[174px] max-w-full" /></Link> : null}
            <LanguageSwitcher />
          </header>
          <div className={`mx-auto flex w-full flex-1 flex-col justify-center ${isSignIn ? `${styles.content} max-w-[360px]` : isSignUp ? `${styles.signupContent} max-w-[590px]` : "max-w-[590px] py-12 sm:py-16"}`}>
            {isSignIn ? <Link href="/login" aria-label="NewAI sign in" className={`${styles.logo} flex items-center justify-center gap-3 self-center text-3xl font-semibold tracking-tight`}><BrandMark className="h-auto w-[224px] max-w-full" /></Link> : null}
            {step ? <AccountSetupProgress current={step} className="mb-[var(--auth-steps-gap,2.25rem)]" /> : null}
            {children}
            {isSignIn ? <footer className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-primary"><Link href="/terms" className="hover:underline">Terms</Link><span aria-hidden="true" className="text-black/40 dark:text-white/40">|</span><Link href="/privacy" className="hover:underline">Privacy</Link></footer> : null}
          </div>
          {!isCompact ? <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-black/55 dark:text-white/55">
            <span>{footer || "Your business. Your team. Your workspace."}</span>
            <span className="flex gap-4"><Link href="/terms" className="hover:underline">Terms</Link><Link href="/privacy" className="hover:underline">Privacy</Link></span>
          </footer> : null}
        </section>
        <aside className={`${isCompact ? styles.story : ""} relative isolate hidden min-w-0 overflow-hidden rounded-md bg-[#0A2D53] p-12 text-white lg:flex xl:p-16`} aria-label="About NewAI">
          <AuthGradient />
          <div className={`${isCompact ? styles.storyContent : ""} relative z-10 flex w-full flex-col justify-between gap-20`}>
            <div className={isCompact ? styles.storyIntro : "pt-12"}><p className="mb-8 text-sm font-medium uppercase tracking-[0.2em] text-white/70">A little more connected.</p><h2 className="text-6xl font-medium leading-[0.98] tracking-[-0.05em] xl:text-[76px]">Think fast,<br />Grow faster.</h2><p className="mt-6 max-w-sm text-lg leading-relaxed text-white/75">Bring your customers, conversations, and team together in one workspace.</p></div>
            <div className={`${isCompact ? styles.storyOutro : "mb-10"} max-w-sm space-y-6`}><div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/15 px-4 py-2 text-xs backdrop-blur-sm"><LockKeyhole className="size-3.5" />Private to you and the people you invite</div><p className="text-2xl font-medium leading-snug tracking-tight">A fresh start for your business.<br />Room for your whole team.</p><Link href="/signup" className="inline-flex items-center gap-3 text-sm text-white/85 underline underline-offset-4">Make it your workspace<ArrowUpRight className="size-4" /></Link></div>
          </div>
        </aside>
      </div>
    </main>
  );
}
