"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive, Bot, Building2, CalendarClock, Check, CheckCircle2, ChevronDown,
  Clock3, FileText, Filter, Forward, Inbox, Languages, Mail, MoreHorizontal,
  Paperclip, Plus, RefreshCw, Reply, Search, Send, Settings2, ShieldCheck,
  Smile, Sparkles, Star, Tag, Trash2, UserRound, WandSparkles, Workflow, Zap,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type EmailWorkspaceItem = {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  subject: string;
  contact: string;
  company: string;
  preview: string;
  body: string;
  timestamp: string;
  step?: string;
  demo?: boolean;
};

type Folder = "inbox" | "all" | "drafts" | "scheduled" | "sent" | "starred";
type Category = "Needs follow-up" | "Waiting on customer" | "Interested" | "Big order" | "No action";

const demoInbox: EmailWorkspaceItem[] = [
  { id: "demo-mail-1", direction: "inbound", status: "Received", subject: "Re: Pet bed wholesale catalog", contact: "Mei Lin", company: "Luna Pet Boutique", preview: "谢谢！可以给我看看批发价格和最低订购量吗？", body: "Hi Filazoo team,\n\n谢谢！可以给我看看批发价格和最低订购量吗？我们计划先为两家门店订购。\n\nBest,\nMei", timestamp: "2026-10-14T09:42:00+08:00", demo: true },
  { id: "demo-mail-2", direction: "inbound", status: "Received", subject: "Sample packs for Milan", contact: "Sofia Rossi", company: "Paw House Milano", preview: "Could you quote shipping for two sample packs to Italy?", body: "Hello,\n\nCould you quote shipping for two sample packs to Milan, Italy? If testing goes well, we would start with 80 units.\n\nKind regards,\nSofia", timestamp: "2026-10-14T08:51:00+08:00", demo: true },
  { id: "demo-mail-3", direction: "inbound", status: "Received", subject: "Re: Recycled-fiber collection", contact: "Noah Williams", company: "The Good Dog Co.", preview: "Please follow up when the collection is back in stock.", body: "Thanks for the update. Please follow up when the recycled-fiber collection is back in stock. We are reviewing the range next week.", timestamp: "2026-10-13T17:23:00+08:00", demo: true },
];

const translations: Record<string, string> = {
  "demo-mail-1": "Hi Filazoo team,\n\nThank you! Could you show me the wholesale prices and minimum order quantity? We plan to order for two stores initially.\n\nBest,\nMei",
};

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-5 w-9 rounded-full ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${checked ? "translate-x-4" : ""}`} /></button>;
}

export function EmailInboxWorkspace({
  initialEmails,
  mailboxConfigured,
  aiConfigured,
  dataMode,
}: {
  initialEmails: EmailWorkspaceItem[];
  mailboxConfigured: boolean;
  aiConfigured: boolean;
  dataMode: "demo" | "live";
}) {
  const router = useRouter();
  const sourceEmails = initialEmails.some((email) => email.direction === "inbound") ? initialEmails : [...demoInbox, ...initialEmails];
  const [emails, setEmails] = useState(sourceEmails);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [selectedId, setSelectedId] = useState(sourceEmails[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [translationOn, setTranslationOn] = useState(true);
  const [aiReplyOn, setAiReplyOn] = useState(true);
  const [starred, setStarred] = useState<Set<string>>(() => new Set());
  const [categories, setCategories] = useState<Record<string, Category>>(() => ({ "demo-mail-1": "Needs follow-up", "demo-mail-2": "Interested", "demo-mail-3": "Waiting on customer" }));
  const [followUps, setFollowUps] = useState<Record<string, string>>(() => ({ "demo-mail-1": "Today, 3:00 PM" }));
  const [flowEnabled, setFlowEnabled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState("Just now");

  useEffect(() => {
    if (!mailboxConfigured) return;
    const refresh = () => {
      router.refresh();
      setLastSync("Just now");
    };
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [mailboxConfigured, router]);

  const selected = emails.find((email) => email.id === selectedId) ?? emails[0];
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return emails.filter((email) => {
      const matchesFolder = folder === "all"
        || (folder === "inbox" && email.direction === "inbound")
        || (folder === "drafts" && email.status.toLowerCase().includes("draft"))
        || (folder === "scheduled" && email.status.toLowerCase().includes("scheduled"))
        || (folder === "sent" && email.status.toLowerCase().includes("sent"))
        || (folder === "starred" && starred.has(email.id));
      return matchesFolder && (!query || `${email.subject} ${email.contact} ${email.company} ${email.preview}`.toLowerCase().includes(query));
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [emails, folder, search, starred]);

  const folderCounts = {
    inbox: emails.filter((email) => email.direction === "inbound").length,
    all: emails.length,
    drafts: emails.filter((email) => email.status.toLowerCase().includes("draft")).length,
    scheduled: emails.filter((email) => email.status.toLowerCase().includes("scheduled")).length,
    sent: emails.filter((email) => email.status.toLowerCase().includes("sent")).length,
    starred: starred.size,
  };

  function toggleStar(id: string) {
    setStarred((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setCategory(category: Category) {
    if (!selected) return;
    setCategories((current) => ({ ...current, [selected.id]: category }));
    setNotice(`Category changed to ${category}.`);
  }

  function setFollowUp(value: string) {
    if (!selected) return;
    setFollowUps((current) => ({ ...current, [selected.id]: value }));
    setCategory("Needs follow-up");
    setNotice(`Follow-up scheduled for ${value}.`);
  }

  function saveReply() {
    if (!selected || !draft.trim()) return;
    const reply: EmailWorkspaceItem = {
      id: `local-${Date.now()}`, direction: "outbound", status: "Draft", subject: `Re: ${selected.subject.replace(/^Re:\s*/i, "")}`,
      contact: selected.contact, company: selected.company, preview: draft.trim(), body: draft.trim(), timestamp: new Date().toISOString(), demo: true,
    };
    setEmails((current) => [reply, ...current]);
    setDraft("");
    setNotice("Reply saved as a CRM draft. Nothing was sent.");
  }

  const folderItems: Array<{ id: Folder; label: string; icon: typeof Inbox }> = [
    { id: "inbox", label: "Inbox", icon: Inbox }, { id: "all", label: "All mail", icon: Mail },
    { id: "drafts", label: "Drafts", icon: FileText }, { id: "scheduled", label: "Scheduled", icon: Clock3 },
    { id: "sent", label: "Sent", icon: Send }, { id: "starred", label: "Starred", icon: Star },
  ];

  return (
    <div className="email-workspace -mx-5 -my-7 flex min-h-[calc(100svh-3rem)] flex-col overflow-hidden bg-[#f7f8fa] dark:bg-background sm:-mx-7 lg:-mx-10 lg:-my-10">
      <header className="border-b bg-background px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
          <div><div className="flex items-center gap-2.5"><h1 className="text-2xl font-semibold tracking-[-0.02em]">Email</h1><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">CRM inbox</span></div><p className="mt-1.5 text-sm text-muted-foreground">Read, translate, reply, and automate every Filazoo customer email.</p></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { router.refresh(); setLastSync("Just now"); }} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted"><RefreshCw className="size-4" />Sync now</button>
            <Link href="/settings" className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted"><Settings2 className="size-4" />Mailbox settings</Link>
          </div>
        </div>
        <div className="flex items-center gap-3 pb-4 text-xs">
          <span className={`size-2 rounded-full ${mailboxConfigured ? "bg-emerald-500" : "bg-amber-400"}`} />
          <span className="font-medium">{mailboxConfigured ? "Filazoo mailbox connected" : "Mailbox setup required"}</span>
          <span className="text-muted-foreground">{mailboxConfigured ? `Scanning CRM every 30 seconds · ${lastSync}` : "Connect SMTP + IMAP to enable live mail"}</span>
          <span className="ml-auto hidden items-center gap-1.5 text-muted-foreground sm:flex"><ShieldCheck className="size-3.5" />{dataMode === "live" ? "Live CRM data" : "Safe demo data"}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-background md:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[190px_340px_minmax(480px,1fr)_310px]">
        <aside className="hidden min-h-0 flex-col border-r bg-muted/10 2xl:flex" aria-label="Email folders">
          <div className="p-3"><button type="button" onClick={() => { setFolder("drafts"); setDraft("Hi,\n\n"); }} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-xs font-semibold text-background hover:bg-foreground/90"><Plus className="size-4" />Compose</button></div>
          <nav className="space-y-1 px-2 py-1">
            {folderItems.map((item) => <button key={item.id} type="button" onClick={() => { setFolder(item.id); const first = emails.find((email) => item.id === "all" || (item.id === "inbox" && email.direction === "inbound") || email.status.toLowerCase().includes(item.id.slice(0, -1))); if (first) setSelectedId(first.id); }} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-xs font-medium ${folder === item.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><item.icon className={`size-4 ${folder === item.id ? "text-primary" : ""}`} /><span className="flex-1 text-left">{item.label}</span><span className="text-[11px]">{folderCounts[item.id]}</span></button>)}
          </nav>
          <div className="mx-4 my-4 h-px bg-border" />
          <div className="px-5"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Automation</p><div className="mt-3 rounded-lg border bg-background p-3"><p className="flex items-center gap-2 text-xs font-semibold"><Workflow className="size-4 text-violet-600" />Follow-up flow</p><p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">Automatically continue conversations that need attention.</p><Link href="/automation" className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline">Open builder →</Link></div></div>
        </aside>

        <section className="flex min-h-0 flex-col border-r" aria-label="Email list">
          <div className="border-b p-3"><div className="mb-3 flex items-center justify-between px-1"><div><h2 className="text-base font-semibold">{folderItems.find((item) => item.id === folder)?.label}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{visible.length} conversations</p></div><button type="button" title="Filter email" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Filter className="size-4" /></button></div><label className="flex h-9 items-center gap-2 rounded-md border bg-muted/30 px-2.5 focus-within:border-primary/50"><Search className="size-4 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search mail" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visible.length ? visible.map((email) => {
              const active = email.id === selected?.id;
              return <button key={email.id} type="button" onClick={() => setSelectedId(email.id)} className={`relative mb-1.5 flex w-full gap-3 rounded-xl p-3.5 text-left ${active ? "bg-blue-50 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.12)] dark:bg-blue-500/10" : "hover:bg-muted/60"}`}>{active ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-r bg-blue-500" /> : null}<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f] dark:bg-muted dark:text-foreground">{initials(email.contact)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-xs font-semibold">{email.contact}</p><span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(email.timestamp)}</span></div><p className="mt-1 truncate text-xs font-medium">{email.subject}</p><p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{email.preview}</p><div className="mt-2 flex items-center gap-2"><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">{categories[email.id] || email.status}</span>{email.direction === "inbound" ? <span className="size-2 rounded-full bg-blue-500" /> : null}</div></div></button>;
            }) : <div className="m-2 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">No email matches this folder.</div>}
          </div>
        </section>

        <main className="hidden min-h-0 flex-col bg-[#fbfbfc] dark:bg-background md:flex" aria-label="Email reader">
          {selected ? <>
            <div className="flex min-h-16 items-center justify-between gap-3 border-b bg-background px-5"><div className="min-w-0"><h2 className="truncate text-base font-semibold">{selected.subject}</h2><p className="mt-1 text-xs text-muted-foreground">{selected.direction === "inbound" ? "From" : "To"} {selected.contact} · {selected.company}</p></div><div className="flex items-center gap-1"><button type="button" title={starred.has(selected.id) ? "Remove star" : "Star email"} onClick={() => toggleStar(selected.id)} className={`rounded-md p-2 hover:bg-muted ${starred.has(selected.id) ? "text-amber-500" : "text-muted-foreground"}`}><Star className="size-4" fill={starred.has(selected.id) ? "currentColor" : "none"} /></button><button type="button" title="Archive" onClick={() => setNotice("Email archived locally.")} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Archive className="size-4" /></button><DropdownMenu><DropdownMenuTrigger aria-label="More email actions" className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuLabel>Email actions</DropdownMenuLabel><DropdownMenuItem onClick={() => setNotice("Reply composer opened.")}><Reply />Reply</DropdownMenuItem><DropdownMenuItem onClick={() => setNotice("Forward draft created.")}><Forward />Forward</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setNotice("Email moved to trash locally.")}><Trash2 />Move to trash</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6"><article className="mx-auto max-w-3xl"><div className="flex items-start gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f] dark:bg-muted dark:text-foreground">{initials(selected.contact)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><p className="text-sm font-semibold">{selected.contact}</p><p className="mt-0.5 text-xs text-muted-foreground">{selected.company}</p></div><time className="text-xs text-muted-foreground">{formatTime(selected.timestamp)}</time></div><div className="mt-5 whitespace-pre-wrap rounded-xl border bg-background p-5 text-sm leading-7 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">{selected.body}</div>{translationOn && translations[selected.id] ? <div className="mt-3 rounded-xl border border-violet-200/70 bg-violet-50/60 p-4 dark:border-violet-500/20 dark:bg-violet-500/5"><p className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-300"><Languages className="size-4" />Translated to English</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{translations[selected.id]}</p></div> : null}</div></div></article></div>
            <div className="border-t bg-background p-4"><div className="mx-auto max-w-3xl"><div className="mb-2 flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 rounded-md border bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"><Languages className="size-4" />Auto-translate<Toggle checked={translationOn} onChange={() => setTranslationOn((value) => !value)} label="Toggle email translation" /></div><div className="flex items-center gap-2 rounded-md border bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Bot className="size-4" />AI writing<Toggle checked={aiReplyOn} onChange={() => setAiReplyOn((value) => !value)} label="Toggle AI writing" /></div>{!aiConfigured ? <span className="text-[11px] text-amber-700">AI provider not configured — using safe suggestions</span> : null}</div>{aiReplyOn ? <div className="mb-2 flex gap-2 overflow-x-auto"><span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-600"><Sparkles className="size-3.5" />Suggestions</span>{["Send pricing + MOQ", "Confirm shipping details", "Schedule a follow-up"].map((item) => <button key={item} type="button" onClick={() => setDraft(item === "Send pricing + MOQ" ? `Hi ${selected.contact.split(" ")[0]},\n\nThanks for your message. I’ll send our current wholesale pricing and minimum order quantities for your review.\n\nBest,\nFilazoo` : item === "Confirm shipping details" ? `Hi ${selected.contact.split(" ")[0]},\n\nWe can prepare a shipping quote. Could you confirm the delivery postcode and expected quantity?\n\nBest,\nFilazoo` : `Hi ${selected.contact.split(" ")[0]},\n\nI’ll follow up with you shortly with the latest availability and next steps.\n\nBest,\nFilazoo`)} className="shrink-0 rounded-full border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">{item}</button>)}</div> : null}<div className="rounded-xl border bg-background focus-within:border-primary/50"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Write a reply to ${selected.contact}…`} className="min-h-24 w-full resize-none bg-transparent p-3.5 text-sm leading-6 outline-none" /><div className="flex items-center justify-between border-t px-2 py-2"><div className="flex gap-1"><button type="button" disabled title="Attachments require mailbox media setup" className="cursor-not-allowed rounded-md p-2 text-muted-foreground opacity-40"><Paperclip className="size-4" /></button><button type="button" title="Add emoji" onClick={() => setDraft((value) => `${value}${value ? " " : ""}😊`)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Smile className="size-4" /></button><button type="button" title="Write with AI" onClick={() => setDraft((value) => value || `Hi ${selected.contact.split(" ")[0]},\n\nThanks for your email. I’d be happy to help.\n\nBest,\nFilazoo`)} className="rounded-md p-2 text-violet-600 hover:bg-violet-50"><WandSparkles className="size-4" /></button></div><div className="flex items-center gap-2"><span className="text-[11px] text-muted-foreground">Saved to CRM, not sent automatically</span><button type="button" onClick={saveReply} disabled={!draft.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-40"><FileText className="size-4" />Save reply draft</button></div></div></div>{notice ? <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p> : null}</div></div>
          </> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select an email to read it.</div>}
        </main>

        {selected ? <aside className="hidden min-h-0 flex-col border-l bg-background 2xl:flex" aria-label="Email follow-up details">
          <div className="flex h-16 items-center justify-between border-b px-5"><h2 className="text-sm font-semibold">Follow-up details</h2><Tag className="size-4 text-muted-foreground" /></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b p-5"><div className="flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f]">{initials(selected.contact)}</div><div><p className="text-sm font-semibold">{selected.contact}</p><p className="mt-0.5 text-xs text-muted-foreground">{selected.company}</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><Link href="/companies" className="flex h-9 items-center justify-center gap-2 rounded-md border text-xs font-semibold hover:bg-muted"><Building2 className="size-4" />CRM profile</Link><button type="button" onClick={() => setNotice("Contact owner is now assigned.")} className="flex h-9 items-center justify-center gap-2 rounded-md border text-xs font-semibold hover:bg-muted"><UserRound className="size-4" />Assign</button></div></div>
            <div className="border-b p-5"><h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Category</h3><div className="mt-3 space-y-2">{(["Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"] as Category[]).map((category) => <button key={category} type="button" onClick={() => setCategory(category)} className={`flex h-9 w-full items-center gap-2 rounded-md border px-3 text-left text-xs font-medium ${categories[selected.id] === category ? "border-primary/30 bg-primary/10 text-foreground" : "hover:bg-muted"}`}><span className={`size-2 rounded-full ${category === "Big order" ? "bg-amber-500" : category === "Interested" ? "bg-emerald-500" : category === "Needs follow-up" ? "bg-blue-500" : "bg-muted-foreground/40"}`} /><span className="flex-1">{category}</span>{categories[selected.id] === category ? <Check className="size-3.5 text-primary" /> : null}</button>)}</div></div>
            <div className="border-b p-5"><h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><CalendarClock className="size-4" />Next follow-up</h3><p className="mt-3 text-sm font-semibold">{followUps[selected.id] || "Not scheduled"}</p><div className="mt-3 grid grid-cols-3 gap-2">{["Today", "Tomorrow", "In 3 days"].map((value) => <button key={value} type="button" onClick={() => setFollowUp(value)} className="rounded-md border px-2 py-2 text-[11px] font-medium hover:bg-muted">{value}</button>)}</div></div>
            <div className="border-b p-5"><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><Workflow className="size-4" />Automation flow</h3><Toggle checked={flowEnabled} onChange={() => setFlowEnabled((value) => !value)} label="Toggle follow-up automation" /></div><div className={`mt-3 rounded-lg border p-3 ${flowEnabled ? "bg-emerald-50/60 dark:bg-emerald-500/5" : "bg-muted/20"}`}><p className="text-xs font-semibold">3-step follow-up</p><div className="mt-3 space-y-3 text-[11px]"><p className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-background font-semibold">1</span>Wait 2 days</p><p className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-background font-semibold">2</span>Send helpful reminder</p><p className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-background font-semibold">3</span>Create CRM task</p></div><Link href="/automation" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border bg-background py-2 text-xs font-semibold hover:bg-muted"><Workflow className="size-4" />Edit automation</Link></div></div>
            <div className="p-5"><h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">AI insight</h3><div className="mt-3 rounded-lg border border-violet-200/70 bg-violet-50/60 p-4 dark:bg-violet-500/5"><p className="flex items-center gap-2 text-xs font-semibold text-violet-700"><Zap className="size-4" />Buying signal detected</p><p className="mt-2 text-xs leading-5 text-muted-foreground">The contact asked about pricing, MOQ, or delivery. Follow up within one business day.</p></div></div>
          </div>
        </aside> : null}
      </div>
    </div>
  );
}
