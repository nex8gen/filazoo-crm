import Link from "next/link";
import { ArrowUpRight, Building2, ReceiptText } from "lucide-react";
import { EmailSenderAvatar } from "@/components/email-sender-avatar";

type ContactSummaryProps = {
  name: string;
  email: string;
  company: string;
  companyId?: string | null;
  canCreateInvoices: boolean;
};

export function ContactSummary({ name, email, company, companyId, canCreateInvoices }: ContactSummaryProps) {
  const companyLabel = company && company !== "Unknown company" ? company : "No linked company";
  return <section className="mx-6 my-4 rounded-xl border border-[#3ecf8e]/30 bg-linear-to-br from-[#a7f3d0]/10 via-[#a7f3d0]/20 to-[#3ecf8e]/15 p-3 dark:border-[#3ecf8e]/20 dark:from-[#a7f3d0]/5 dark:via-[#3ecf8e]/10 dark:to-[#08794e]/20" aria-label="Contact">
    <div className="flex items-center gap-2.5">
      <EmailSenderAvatar companyId={companyId} email={email} name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-5 tracking-tight [overflow-wrap:anywhere]">{name}</p>
          {companyId && <Link href={`/companies/${companyId}`} aria-label={`View ${companyLabel} profile`} title="View customer profile" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ArrowUpRight aria-hidden="true" className="size-4" /></Link>}
        </div>
        {name !== email && <p className="mt-0.5 break-words text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">{email}</p>}
      </div>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#3ecf8e]/20 pt-2 dark:border-[#3ecf8e]/15">
      <p className="flex min-w-0 flex-1 basis-24 items-start gap-1.5 text-xs leading-5 text-muted-foreground"><Building2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{companyLabel}</span></p>
      {companyId && canCreateInvoices && <Link href={`/companies/${companyId}?tab=purchase-orders`} target="_blank" rel="noreferrer" title="Open purchase orders in a new tab" className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ReceiptText aria-hidden="true" className="size-3.5" /><span>Purchase orders</span><ArrowUpRight aria-hidden="true" className="size-3" /></Link>}
    </div>
  </section>;
}
