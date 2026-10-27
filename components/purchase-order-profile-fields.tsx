"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
          <Select
            value={customer.contactId ?? ""}
            onValueChange={(selectedValue) => {
              if (selectedValue === null) return;
              const contact = profile.contacts.find(
                (item) => item.id === selectedValue,
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
            <SelectTrigger id="po-company-contact" className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
            <SelectItem value="">No linked contact</SelectItem>
            {customer.contactId &&
              !profile.contacts.some(
                (item) => item.id === customer.contactId,
              ) && (
                <SelectItem value={customer.contactId}>
                  {customer.contactName || customer.contactEmail} (saved
                  contact)
                </SelectItem>
              )}
            {profile.contacts.map((contact) => (
              <SelectItem key={contact.id} value={contact.id}>
                {contact.name || contact.email} · {contact.email}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
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
