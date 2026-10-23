import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Invoice } from "@/lib/invoices";

export function InvoiceCreator({ invoice }: { invoice: Invoice }) {
  const name = invoice.creator_name || (invoice.created_by ? "Workspace member" : "Creator not recorded");
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return <div className="flex min-w-0 items-center gap-2.5" title={name}>
    <Avatar className="size-7 shrink-0">
      {invoice.creator_avatar_url && <AvatarImage src={invoice.creator_avatar_url} alt="" />}
      <AvatarFallback aria-hidden="true" className="bg-brand-soft text-[10px] font-medium text-primary">{initials}</AvatarFallback>
    </Avatar>
    <span className="max-w-44 truncate text-xs font-medium">{name}</span>
  </div>;
}
