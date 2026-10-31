"use client";

import { useRef, useState } from "react";
import { CustomerTagIcon } from "@/components/customer-tag-badges";
import { customerTags, uniqueCustomerTags, type CustomerTag } from "@/lib/customer-tags";
import "./company-list-tags.css";

// Pending revenue and customer commitments come before passive relationship states.
const companyTagPriority: readonly CustomerTag[] = [
  "Payment Follow-up", "Orders in Fulfillment", "Active Negotiations", "Quotation Follow-up",
  "New Inquiries", "Postponed Purchasing", "Repeat Customers", "Prospect Nurturing",
  "Inactive Customers", "Long-term Inactive Customers",
];

export function CompanyListTags({ tags = [], className = "" }: { tags?: readonly string[]; className?: string }) {
  const group = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState<CustomerTag | null>(null);
  const selected = new Set(uniqueCustomerTags(tags));
  const ordered = companyTagPriority.filter(tag => selected.has(tag));
  const compactCount = Math.max(0, ordered.length - 2);
  const displayed = [...ordered.slice(2), ...ordered.slice(0, 2)];
  const canExpand = ordered.length > 2;
  if (!ordered.length) return null;

  function reset() {
    setActive(null);
  }

  return <span ref={group} aria-label="Customer tags" className={`company-list-tags ${className}`}
    onPointerMove={event => {
      if (!canExpand || event.pointerType === "touch") return;
      const index = (event.target as HTMLElement).closest<HTMLElement>("[data-company-tag-index]")?.dataset.companyTagIndex;
      if (index === undefined) return;
      const position = Number(index);
      if (position < compactCount || active !== null) setActive(displayed[position]);
    }}
    onPointerLeave={() => { if (!group.current?.contains(document.activeElement)) reset(); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) reset(); }}
    onKeyDown={event => { if (event.key === "Escape") reset(); }}>
    {/* This permanent, hidden preview sizes the table before any hover begins.
        The animated layer cannot change the row's intrinsic column widths. */}
    <span aria-hidden="true" className="company-list-tags-sizer">
      {displayed.map((tag, index) => <span key={tag} className="company-list-tag" data-expanded={index >= compactCount}
        style={{ marginLeft: index > 0 && index < compactCount ? -14 : 0 }}>
        <CustomerTagIcon tag={tag} /><span className="company-list-tag-caption">{tag}</span>
      </span>)}
    </span>
    <span className="company-list-tags-live">
    {displayed.map((tag, index) => {
      const item = customerTags.find(item => item.name === tag)!;
      const expanded = active === null ? index >= compactCount : active === tag;
      // Keep the hovered chip's starting position unchanged. Only chips after it move.
      const overlap = index > 0 && index < compactCount && displayed[index - 1] !== active;
      return <span key={tag} role="img" aria-label={tag} title={item.description} tabIndex={canExpand ? 0 : undefined}
        data-company-tag-index={index} data-expanded={expanded}
        className={`company-list-tag ${item.className}`}
        style={{ marginLeft: overlap ? -14 : 0, zIndex: active === tag ? 20 : displayed.length - index }}
        onFocus={() => { if (canExpand) setActive(tag); }}>
        <CustomerTagIcon tag={tag} />
        <span aria-hidden="true" className="company-list-tag-caption">{tag}</span>
      </span>;
    })}
    </span>
  </span>;
}
