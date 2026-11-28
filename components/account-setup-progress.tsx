import { Check } from "lucide-react";
import styles from "./account-setup-progress.module.css";

export function AccountSetupProgress({ current, className = "" }: { current: 1 | 2 | 3; className?: string }) {
  return <ol aria-label="Account setup progress" className={`${styles.progress} ${className}`}>
    {["Account", "Plan", "Get started"].map((label, index) => <li key={label} aria-current={current === index + 1 ? "step" : undefined} data-state={current > index + 1 ? "complete" : current === index + 1 ? "current" : "upcoming"} className={styles.step}>
      <span className={styles.marker}>{current > index + 1 ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : index + 1}</span>
      <span className={styles.label}>{label}</span>
      {index < 2 ? <span className={styles.connector} aria-hidden="true" /> : null}
    </li>)}
  </ol>;
}
