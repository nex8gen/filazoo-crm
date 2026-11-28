import type { ReactNode } from "react";

export function SecuritySetting({ title, status, actions, children }: { title: string; status?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <section className="security-setting" aria-label={title}>
    <header className="security-setting-header">
      <div className="security-setting-heading"><h2>{title}</h2>{status}</div>
      {actions ? <div className="security-setting-actions">{actions}</div> : null}
    </header>
    {children ? <div className="security-setting-content">{children}</div> : null}
  </section>;
}
