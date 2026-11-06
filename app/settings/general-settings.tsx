import Link from "next/link";
import { Building2, ChevronRight, Mail, UserRound } from "lucide-react";
import type { WorkspaceViewer } from "@/lib/auth";
import { PreferencesForm } from "./preferences-form";
import { SettingsLanguage } from "./settings-language";

export function GeneralSettings({ viewer }: { viewer: Pick<WorkspaceViewer, "workspaceName" | "displayName" | "email" | "role"> }) {
  return <div className="settings-content settings-general settings-section-enter">

    <section aria-labelledby="business-details-title" className="settings-general-section">
      <h2 id="business-details-title">Business details</h2>
      <p className="settings-section-description">Your workspace and the team behind your business.</p>
      <div className="settings-detail-card">
        <Link href="/settings/workspace" className="settings-detail-row"><span className="settings-business-icon"><Building2 aria-hidden="true" /></span><span className="settings-detail-copy"><strong>{viewer.workspaceName}</strong><span>Workspace details and ownership</span></span><ChevronRight aria-hidden="true" className="settings-row-chevron" /></Link>
      </div>
      <p className="settings-section-note">Manage your business in <Link href="/settings/workspace">Workspace settings</Link></p>
    </section>

    <section aria-labelledby="contact-details-title" className="settings-general-section">
      <h2 id="contact-details-title">Account contact details</h2>
      <div className="settings-detail-card settings-contact-card">
        <Link href="/settings/profile" className="settings-detail-row"><UserRound aria-hidden="true" /><span className="settings-detail-copy"><strong>{viewer.displayName || "Your profile"}</strong><span>{viewer.email || "Manage your account profile"}</span></span><ChevronRight aria-hidden="true" className="settings-row-chevron" /></Link>
        <Link href="/settings/mailboxes" className="settings-detail-row"><Mail aria-hidden="true" /><span className="settings-detail-copy"><strong>My mailbox</strong><span>Manage your email connection and sender details</span></span><ChevronRight aria-hidden="true" className="settings-row-chevron" /></Link>
      </div>
    </section>

    <section aria-labelledby="workspace-defaults-title" className="settings-general-section">
      <h2 id="workspace-defaults-title">Workspace defaults</h2>
      <div className="settings-defaults-card"><h3>Language</h3><p className="settings-section-description">Choose English or Chinese for this browser.</p><SettingsLanguage /></div>
      <div className="settings-defaults-card"><h3>List preferences</h3><p className="settings-section-description">Choose how many records you see when browsing your CRM.</p><PreferencesForm section="general" /></div>
      <p className="settings-section-note">Manage shared business details and currency in <Link href="/settings/invoices">Invoice defaults</Link>.</p>
    </section>
  </div>;
}
