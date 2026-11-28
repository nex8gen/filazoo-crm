import Link from "next/link";
import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { AccountSetupProgress } from "@/components/account-setup-progress";
import styles from "./onboarding-shell.module.css";

/** Full-page frame for checkout and the final workspace setup step. */
export function OnboardingShell({ children, step }: { children: ReactNode; step?: 1 | 2 | 3 }) {
  return <main className={styles.page}>
    <div className={styles.body}>
      {step ? <AccountSetupProgress current={step} className={styles.progress} /> : null}
      {children}
    </div>
    <footer className={styles.footer}>
      <span><LockKeyhole size={13} aria-hidden="true" />Your workspace. Your data. Your team.</span>
      <nav aria-label="Legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></nav>
    </footer>
  </main>;
}
