import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Check, LockKeyhole } from "lucide-react";
import { BrandMarkIcon } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AuthGradient } from "@/components/ui/auth-gradient";

// Shared frame adapted from the supplied AuthSectionOne design. Forms remain
// separate so account, recovery, invitation and onboarding actions stay native.
export default function AuthSectionOne({ children, footer, step }: { children: ReactNode; footer?: string; step?: number }) {
  return (
    <main className="min-h-svh bg-white p-3 text-black antialiased dark:bg-[#050505] dark:text-white">
      <div className="grid min-h-[calc(100svh-1.5rem)] gap-3 lg:grid-cols-[0.94fr_1.06fr]">
        <section className="flex min-w-0 flex-col rounded-md border border-black/20 bg-white px-6 py-7 sm:px-10 dark:border-white/15 dark:bg-[#0a0a0a] lg:px-12 xl:px-20">
          <header className="flex items-center justify-between gap-4">
            <Link href="/login" aria-label="Filazoo sign in" className="flex items-center gap-2.5 font-semibold tracking-tight"><BrandMarkIcon className="h-7 w-auto text-primary" /><span>Filazoo</span></Link>
            <LanguageSwitcher />
          </header>
          <div className="mx-auto flex w-full max-w-[590px] flex-1 flex-col justify-center py-12 sm:py-16">
            {step ? <AuthSteps current={step} /> : null}
            {children}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-black/55 dark:text-white/55">
            <span>{footer || "Your business. Your team. Your workspace."}</span>
            <span className="flex gap-4"><Link href="/terms" className="hover:underline">Terms</Link><Link href="/privacy" className="hover:underline">Privacy</Link></span>
          </footer>
        </section>
        <aside className="relative isolate hidden min-w-0 overflow-hidden rounded-md bg-[#052e20] p-12 text-white lg:flex xl:p-16" aria-label="About Filazoo">
          <AuthGradient />
          <div className="relative z-10 flex w-full flex-col justify-between gap-20">
            <div className="pt-12"><p className="mb-8 text-sm font-medium uppercase tracking-[0.2em] text-white/70">A little more connected.</p><h2 className="text-6xl font-medium leading-[0.98] tracking-[-0.05em] xl:text-[76px]">Think fast,<br />Grow faster.</h2><p className="mt-6 max-w-sm text-lg leading-relaxed text-white/75">Bring your customers, conversations, and team together in one workspace.</p></div>
            <div className="mb-10 max-w-sm space-y-6"><div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/15 px-4 py-2 text-xs backdrop-blur-sm"><LockKeyhole className="size-3.5" />Private to you and the people you invite</div><p className="text-2xl font-medium leading-snug tracking-tight">A fresh start for your business.<br />Room for your whole team.</p><Link href="/signup" className="inline-flex items-center gap-3 text-sm text-white/85 underline underline-offset-4">Make it your workspace<ArrowUpRight className="size-4" /></Link></div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function AuthSteps({ current }: { current: number }) {
  return <ol aria-label="Account setup progress" className="mb-9 flex flex-wrap gap-x-5 gap-y-3 text-xs text-black/55 dark:text-white/55">{["Account", "Verify email", "Workspace", "Get started"].map((label, index) => <li key={label} aria-current={current === index + 1 ? "step" : undefined} className={`flex items-center gap-2 ${current === index + 1 ? "font-medium text-primary" : ""}`}><span className={`grid size-5 place-items-center rounded-full border ${current >= index + 1 ? "border-primary bg-primary text-primary-foreground" : "border-black/20 dark:border-white/20"}`}>{current > index + 1 ? <Check className="size-3" /> : index + 1}</span>{label}</li>)}</ol>;
}
