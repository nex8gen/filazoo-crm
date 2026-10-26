"use client";

import Link from "next/link";
import type {
  OrderProfile,
  PurchaseOrderDocument,
} from "@/lib/purchase-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PurchaseOrderProfileFields({
  companyId,
  document,
  profile,
  locked,
  onChange,
  onRefresh,
}: {
  companyId: string;
  document: PurchaseOrderDocument;
  profile: OrderProfile;
  locked: boolean;
  onChange: (document: PurchaseOrderDocument) => void;
  onRefresh: () => void;
}) {
  const customer = document.customer;
  if (!customer)
    return (
      <Button type="button" variant="outline" onClick={onRefresh}>
        Load company profile
      </Button>
    );
  const field = (
    key:
      | "companyName"
      | "contactName"
      | "contactRole"
      | "contactEmail"
      | "billingEmail"
      | "taxId"
      | "phone",
    label: string,
    type = "text",
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`po-customer-${key}`}>{label}</Label>
      <Input
        id={`po-customer-${key}`}
        type={type}
        value={customer[key]}
        readOnly={locked}
        onChange={(event) =>
          onChange({
            ...document,
            customer: { ...customer, [key]: event.target.value },
          })
        }
      />
    </div>
  );
  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      aria-label="Company profile details"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Company, contact & billing</h3>
          <p className="text-sm text-muted-foreground">
            Copied from the saved profile. These order details carry into its
            invoices.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="self-center text-sm text-primary underline"
            href={`/companies/${companyId}`}
          >
            Open company profile
          </Link>
          {!locked && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
            >
              Refresh from saved profile
            </Button>
          )}
        </div>
      </div>
      <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
        {field("companyName", "Company name")}
        <div className="space-y-2">
          <Label htmlFor="po-company-contact">Company contact</Label>
          <select
            id="po-company-contact"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={customer.contactId ?? ""}
            onChange={(event) => {
              const contact = profile.contacts.find(
                (item) => item.id === event.target.value,
              );
              onChange({
                ...document,
                customer: {
                  ...customer,
                  contactId: contact?.id,
                  contactName: contact?.name || "",
                  contactRole: contact?.role || "",
                  contactEmail: contact?.email || "",
                  billingEmail: !customer.billingEmail || customer.billingEmail === customer.contactEmail ? (profile.commerce.email || contact?.email || "") : customer.billingEmail,
                },
              });
            }}
          >
            <option value="">No linked contact</option>
            {customer.contactId &&
              !profile.contacts.some(
                (item) => item.id === customer.contactId,
              ) && (
                <option value={customer.contactId}>
                  {customer.contactName || customer.contactEmail} (saved
                  contact)
                </option>
              )}
            {profile.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name || contact.email} · {contact.email}
              </option>
            ))}
          </select>
        </div>
        {field("contactName", "Contact name")}
        {field("contactRole", "Job title")}
        {field("contactEmail", "Contact email", "email")}
        {field("phone", "Company phone", "tel")}
        {field("billingEmail", "Billing email", "email")}
        {field("taxId", "Tax / VAT number")}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="po-billing-address">Billing address</Label>
          <Textarea
            id="po-billing-address"
            value={customer.billingAddress}
            maxLength={2000}
            onChange={(event) =>
              onChange({
                ...document,
                customer: { ...customer, billingAddress: event.target.value },
              })
            }
          />
        </div>
      </fieldset>
    </section>
  );
}
