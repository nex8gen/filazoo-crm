import { Archive, CalendarClock, FileClock, Handshake, MessageCirclePlus, Moon, PackageCheck, Repeat2, Sprout, Wallet, type LucideIcon } from "lucide-react";
import { customerTags, uniqueCustomerTags, type CustomerTag } from "@/lib/customer-tags";

const tagIcons: Record<CustomerTag, LucideIcon> = {
  "Prospect Nurturing": Sprout,
  "New Inquiries": MessageCirclePlus,
  "Quotation Follow-up": FileClock,
  "Active Negotiations": Handshake,
  "Payment Follow-up": Wallet,
  "Orders in Fulfillment": PackageCheck,
  "Repeat Customers": Repeat2,
  "Inactive Customers": Moon,
  "Long-term Inactive Customers": Archive,
  "Postponed Purchasing": CalendarClock,
};

export function CustomerTagIcon({ tag }: { tag: CustomerTag }) {
  const Icon = tagIcons[tag];
  return <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.8} fill="currentColor" fillOpacity={0.16} />;
}

export function CustomerTagLabel({ tag, iconOnly = false }: { tag: CustomerTag; iconOnly?: boolean }) {
  return <span className="inline-flex min-w-0 items-center gap-1.5">
    <CustomerTagIcon tag={tag} />
    {iconOnly ? null : <span className="whitespace-normal">{tag}</span>}
  </span>;
}

export function CustomerTagBadge({ tag, iconOnly = false, stacked = false }: { tag: CustomerTag; iconOnly?: boolean; stacked?: boolean }) {
  const item = customerTags.find(item => item.name === tag)!;
  return <span role={iconOnly ? "img" : undefined} aria-label={iconOnly ? tag : undefined} title={iconOnly ? `${tag}: ${item.description}` : item.description} className={`inline-flex max-w-full items-center text-[11px] font-semibold leading-4 ${stacked ? "rounded-full ring-2 ring-background" : "rounded-lg"} ${iconOnly ? `${stacked ? "size-7" : "size-6"} shrink-0 justify-center` : "px-2 py-1"} ${item.className}`}>
    <CustomerTagLabel tag={tag} iconOnly={iconOnly} />
  </span>;
}

export function CustomerTagBadges({ tags = [], className = "", compactWhenMultiple = false }: { tags?: readonly string[]; className?: string; compactWhenMultiple?: boolean }) {
  const selected = uniqueCustomerTags(tags);
  if (!selected.length) return null;
  const iconOnly = compactWhenMultiple && selected.length > 1;
  return <span aria-label="Customer tags" className={`flex ${iconOnly ? "flex-nowrap gap-1" : "flex-wrap gap-1.5"} ${className}`}>
    {selected.map(tag => <CustomerTagBadge key={tag} tag={tag} iconOnly={iconOnly} />)}
  </span>;
}
