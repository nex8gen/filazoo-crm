"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, Copy, Mail, Users } from "lucide-react";
import { createTeamInvitation } from "@/app/settings/team-actions";
import { saveGmailConnection } from "@/app/settings/apps/gmail-actions";
import { saveNeteaseConnection } from "@/app/settings/apps/netease-actions";
import { savePersonalMailbox } from "@/app/settings/actions";
import { createCompany } from "@/app/crm-actions";
import styles from "./setup-wizard.module.css";

type Step = "team" | "email" | "customer";
type Result = { error?: string; success?: string; invitationUrl?: string };
type Draft = Record<string, string>;
const content = {
  team: { title: "Invite your team", description: "Bring your people into the workspace. Start with one teammate.", label: "Team", icon: Users },
  email: { title: "Connect your email", description: "Bring your customer conversations into your workspace.", label: "Email", icon: Mail },
  customer: { title: "Add your first customer", description: "Start a relationship with a company and the person you work with.", label: "Customer", icon: Building2 },
};

export function SetupWizard({ workspaceName, canInvite, canAddCustomer }: { workspaceName: string; canInvite: boolean; canAddCustomer: boolean }) {
  // Keep the sequence stable when a successful invitation revalidates capacity.
  const [steps] = useState<Step[]>(() => [...(canInvite ? ["team" as const] : []), "email", ...(canAddCustomer ? ["customer" as const] : [])]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Partial<Record<Step, Result>>>({});
  const [drafts, setDrafts] = useState<Record<Step, Draft>>({ team: { role: "operator" }, email: { provider: "gmail", smtpPort: "587", imapPort: "993", serverProfile: "standard", neteasePort: "994", historyLimit: "500" }, customer: {} });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = steps[index];
  const done = index >= steps.length;
  const result = step ? results[step] : undefined;
  const saved = Boolean(result?.success);
  const draft = step ? drafts[step] : {};
  const update = (name: string, value: string) => setDrafts(previous => ({ ...previous, [step]: { ...previous[step], [name]: value } }));
  useEffect(() => { heading.current?.focus(); }, [index]);

  const [, action, pending] = useActionState<Result | undefined, FormData>(async (_previous, form) => {
    if (!step || results[step]?.success) return results[step];
    let response: Result | undefined;
    try {
      if (step === "team") response = await createTeamInvitation(undefined, form);
      else if (step === "customer") response = await createCompany(undefined, form);
      else {
        form.set("mailboxId", "");
        form.set("mailboxScope", "personal");
        form.set("syncPreferences", JSON.stringify({ historyLimit: Number(draft.historyLimit), historyFolders: "inbox_sent", historyPaused: false }));
        if (draft.provider === "gmail") {
          form.set("appPassword", String(form.get("password") ?? ""));
          response = await saveGmailConnection(undefined, form);
        } else if (draft.provider === "netease") {
          form.set("clientPassword", String(form.get("password") ?? ""));
          form.set("smtpPort", draft.neteasePort);
          response = await saveNeteaseConnection(undefined, form);
        } else {
          form.set("smtpUsername", draft.smtpUsername || draft.email);
          form.set("imapUsername", draft.imapUsername || draft.email);
          form.set("smtpPassword", draft.password || "");
          form.set("imapPassword", draft.imapPassword || draft.password || "");
          form.set("notes", "");
          response = await savePersonalMailbox(undefined, form);
        }
      }
    } catch { response = { error: "Unable to save this step. Please try again." }; }
    const next = response ?? { error: "Unable to confirm this step. Please try again." };
    setResults(previous => ({ ...previous, [step]: next }));
    if (next.success && step !== "team") {
      if (step === "email") setDrafts(previous => ({ ...previous, email: { ...previous.email, password: "", imapPassword: "" } }));
      setIndex(value => value + 1);
    }
    return next;
  }, undefined);

  async function copyInvitation() {
    if (!result?.invitationUrl) return;
    try { await navigator.clipboard.writeText(result.invitationUrl); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }

  const Icon = done ? Check : content[step].icon;
  return <div className={styles.wizard}>
    <div className={styles.hero}>
      <p className={styles.eyebrow}>{workspaceName}</p>
      <h1 ref={heading} tabIndex={-1} className={styles.title}>{done ? "You're ready to go" : content[step].title}</h1>
      <p className={styles.description}>{done ? "Your workspace is ready. You can finish any skipped steps from Settings." : content[step].description}</p>
      <ol className={styles.progress} aria-label="Workspace setup">
        {steps.map((item, position) => <li key={item} aria-current={!done && position === index ? "step" : undefined} data-active={position === index} data-complete={Boolean(results[item]?.success)}>
          <span>{results[item]?.success ? <Check size={13} aria-hidden="true" /> : position + 1}</span>{content[item].label}
        </li>)}
      </ol>
    </div>
    {done ? <section className={styles.finish} aria-labelledby="setup-complete-title">
      <span className={styles.finishIcon}><Icon size={28} aria-hidden="true" /></span>
      <h2 id="setup-complete-title">Make yourself at home</h2>
      <ul>{steps.map(item => <li key={item}><span>{content[item].label}</span><span>{results[item]?.success ? "Complete" : "Skipped for now"}</span></li>)}</ul>
      <Link href="/analytics" className={styles.primary}>Open your CRM<ArrowRight size={16} aria-hidden="true" /></Link>
      <button type="button" className={styles.textButton} onClick={() => setIndex(steps.length - 1)}><ArrowLeft size={14} aria-hidden="true" />Back</button>
    </section> : <>
      <form id="workspace-setup-form" action={action} className={styles.form} aria-busy={pending}>
        <fieldset disabled={pending || saved}>
          {step === "team" ? <>
            <Field label="Teammate's name" name="displayName" draft={draft} update={update} required minLength={2} maxLength={80} autoComplete="name" placeholder="Alex Morgan" />
            <Field label="Email address" name="email" type="email" draft={draft} update={update} required autoComplete="email" placeholder="alex@company.com" />
            <label className={styles.field}>Workspace role<select name="role" value={draft.role} onChange={event => update("role", event.target.value)}><option value="operator">Operator</option><option value="bd_manager">BD manager</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select><span className={styles.hint}>Choose what this teammate can access. You can change their role later.</span></label>
          </> : step === "email" ? <>
            <label className={styles.field}>Email service<select name="provider" value={draft.provider} onChange={event => update("provider", event.target.value)}><option value="gmail">Gmail / Google Workspace</option><option value="netease">NetEase / Lingxi Mail</option><option value="smtp">Other email (SMTP / IMAP)</option></select></label>
            <Field label="Email address" name="email" type="email" draft={draft} update={update} required autoComplete="email" placeholder="you@company.com" />
            <Field label="Connection name" name="displayName" draft={draft} update={update} maxLength={80} placeholder="My work email" />
            <Field label={draft.provider === "gmail" ? "Google app password" : draft.provider === "netease" ? "Client authorization password" : "Email app password"} name="password" type="password" draft={draft} update={update} required maxLength={255} autoComplete="new-password" />
            <p className={styles.hint}>{draft.provider === "gmail" ? "Use the 16-character app password from your Google account settings." : draft.provider === "netease" ? "Enable IMAP/SMTP and generate a client authorization password in your email settings." : "Use the app password provided by your email service. Sending and receiving are tested before saving."}</p>
            {draft.provider === "netease" ? <div className={styles.grid}>
              <label className={styles.field}>Server region<select name="serverProfile" value={draft.serverProfile} onChange={event => update("serverProfile", event.target.value)}><option value="standard">Standard</option><option value="hangzhou">Hangzhou</option><option value="overseas">Overseas</option></select></label>
              <label className={styles.field}>SMTP port<select name="neteasePort" value={draft.neteasePort} onChange={event => update("neteasePort", event.target.value)}><option value="994">994</option><option value="465">465</option></select></label>
            </div> : null}
            {draft.provider === "smtp" ? <div className={styles.serverFields}>
              <div className={styles.grid}><Field label="SMTP host" name="smtpHost" draft={draft} update={update} required placeholder="smtp.example.com" /><Field label="SMTP port" name="smtpPort" type="number" draft={draft} update={update} required min={1} max={65535} /></div>
              <div className={styles.grid}><Field label="IMAP host" name="imapHost" draft={draft} update={update} required placeholder="imap.example.com" /><Field label="IMAP port" name="imapPort" type="number" draft={draft} update={update} required min={1} max={65535} /></div>
              <details><summary>Different usernames or receiving password?</summary><div className={styles.serverFields}>
                <Field label="SMTP username" name="smtpUsername" draft={draft} update={update} placeholder={draft.email || "Your email address"} />
                <Field label="IMAP username" name="imapUsername" draft={draft} update={update} placeholder={draft.email || "Your email address"} />
                <Field label="IMAP password" name="imapPassword" type="password" draft={draft} update={update} maxLength={255} autoComplete="new-password" placeholder="Leave blank to use the same app password" />
              </div></details>
            </div> : null}
            <label className={styles.field}>Email history<select name="historyLimit" value={draft.historyLimit} onChange={event => update("historyLimit", event.target.value)}>{[50, 500, 1000, 5000].map(limit => <option key={limit} value={limit}>Latest {limit.toLocaleString("en-US")} emails per folder</option>)}</select><span className={styles.hint}>Imports Inbox and Sent. New messages keep syncing automatically.</span></label>
          </> : <>
            <Field label="Company name" name="name" draft={draft} update={update} required minLength={2} maxLength={160} autoComplete="organization" placeholder="Acme Industries" />
            <Field label="Website (optional)" name="website" draft={draft} update={update} maxLength={500} autoComplete="url" placeholder="example.com" />
            <div className={styles.grid}><Field label="Country" name="country" draft={draft} update={update} required minLength={2} maxLength={100} autoComplete="country-name" placeholder="e.g. China" /><Field label="City (optional)" name="city" draft={draft} update={update} maxLength={100} autoComplete="address-level2" /></div>
            <Field label="Customer segment" name="segment" draft={draft} update={update} required minLength={2} maxLength={120} placeholder="e.g. Wholesale" />
            <div className={styles.grid}><Field label="Contact name (optional)" name="contactName" draft={draft} update={update} maxLength={120} autoComplete="name" /><Field label={draft.contactName?.trim() ? "Contact email" : "Contact email (optional)"} name="contactEmail" type="email" draft={draft} update={update} required={Boolean(draft.contactName?.trim())} maxLength={320} autoComplete="email" /></div>
            <input type="hidden" name="contactRole" value="" />
          </>}
        </fieldset>
        {result?.error ? <p role="alert" className={styles.error}>{result.error}</p> : null}
        {result?.success ? <div className={styles.success} role="status"><Check size={16} aria-hidden="true" /><p>{result.success}</p></div> : null}
        {step === "team" && result?.invitationUrl ? <div className={styles.invitation}>
          <label className={styles.field}>Invitation link<input value={result.invitationUrl} readOnly onFocus={event => event.currentTarget.select()} /></label>
          <button type="button" className={styles.secondary} onClick={copyInvitation}><Copy size={15} aria-hidden="true" />{copied ? "Copied" : "Copy link"}</button>
          {copyError ? <p role="status" className={styles.hint}>Select the link above and copy it to share with your teammate.</p> : null}
        </div> : null}
      </form>
      <div className={styles.navigation}>
        <button type="button" className={styles.secondary} disabled={pending || index === 0} onClick={() => setIndex(value => value - 1)}><ArrowLeft size={15} aria-hidden="true" />Back</button>
        <div>{!saved ? <button type="button" className={styles.textButton} disabled={pending} onClick={() => setIndex(value => value + 1)}>Skip for now</button> : null}
          {saved ? <button type="button" disabled={pending} className={styles.primary} onClick={() => setIndex(value => value + 1)}>Next<ArrowRight size={16} aria-hidden="true" /></button>
            : <button type="submit" form="workspace-setup-form" disabled={pending} className={styles.primary}>{pending ? step === "email" ? "Checking connection…" : "Saving…" : step === "team" ? "Create invitation" : step === "email" ? "Connect and continue" : "Add customer and continue"}{!pending ? <ArrowRight size={16} aria-hidden="true" /> : null}</button>}
        </div>
      </div>
      <p className={styles.optional}>Every step is optional. You can finish setting up later.</p>
    </>}
  </div>;
}

function Field({ label, name, draft, update, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; draft: Draft; update: (name: string, value: string) => void }) {
  return <label className={styles.field}>{label}<input {...props} name={name} value={draft[name] ?? ""} onChange={event => update(name, event.target.value)} /></label>;
}
