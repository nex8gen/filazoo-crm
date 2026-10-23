import Link from "next/link";
import { ArrowUpRight, Building2, ReceiptText } from "lucide-react";
import { AssignedOwner } from "@/components/assigned-owner";

type ContactSummaryProps = {
  name: string;
  email: string;
  company: string;
  companyId?: string | null;
  ownerName?: string | null;
  ownerInitials?: string | null;
  ownerId?: string | null;
  canCreateInvoices: boolean;
};

export function ContactSummary({ name, email, company, companyId, ownerName, ownerInitials, ownerId, canCreateInvoices }: ContactSummaryProps) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  const companyLabel = company && company !== "Unknown company" ? company : "No linked company";
  return <section className="px-5 py-6" aria-label="Contact">
    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-sm font-semibold text-primary ring-1 ring-primary/5">{initials}</div>
      <div className="min-w-0">
        <p className="break-words text-[15px] font-semibold leading-5 tracking-tight [overflow-wrap:anywhere]">{name}</p>
        {name !== email && <p className="mt-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{email}</p>}
      </div>
    </div>
    <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Building2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 break-words">{companyLabel}</span></p>
    <div className="mt-5 rounded-xl border border-border/60 bg-muted/20 p-3.5">
      <AssignedOwner name={ownerName || "Unassigned"} initials={ownerInitials || ""} assigned={Boolean(ownerId)} label="Account manager" className="w-full [&>span:last-child]:flex-1 [&>span:last-child>span:last-child]:max-w-none" />
    </div>
    {companyId && <div aria-label="Customer shortcuts" className={`mt-3 grid gap-2 ${canCreateInvoices ? "grid-cols-2" : "grid-cols-1"}`}>
      <Link href={`/companies/${companyId}`} className="inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-border/70 px-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Building2 className="size-3.5 shrink-0 text-muted-foreground" /><span className="whitespace-nowrap">View profile</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground" /></Link>
      {canCreateInvoices && <Link href={`/invoices?companyId=${companyId}`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-lg border border-border/70 px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ReceiptText className="size-3.5 shrink-0 text-muted-foreground" /><span>Invoices</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground" /></Link>}
    </div>}
  </section>;
}
