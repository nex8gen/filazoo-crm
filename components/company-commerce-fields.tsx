"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useState } from "react";
import { MapPin, CreditCard } from "lucide-react";
import { commerceDefaults, type CompanyCommerce } from "@/lib/company-commerce";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { invoiceCurrencies } from "@/lib/invoices";

export function CompanyCommerceFields({
  profile,
}: {
  profile?: CompanyCommerce;
}) {
  const values = commerceDefaults(profile);
  const [billingAddress, setBillingAddress] = useState(values.address);
  const [shippingAddress, setShippingAddress] = useState(
    values.shippingAddress,
  );
  const [sameAddress, setSameAddress] = useState(false);
  const fields = (
    keys: {
      key: keyof CompanyCommerce;
      label: string;
      type?: string;
      wide?: boolean;
    }[],
  ) =>
    keys.map(({ key, label, type, wide }) => (
      <div key={key} className={`space-y-2 ${wide ? "sm:col-span-2" : ""}`}>
        <Label htmlFor={`commerce-${key}`}>{label}</Label>
        <Input
          id={`commerce-${key}`}
          name={`commerce.${key}`}
          type={type || "text"}
          min={type === "number" ? 0 : undefined}
          max={type === "number" ? 365 : undefined}
          defaultValue={values[key]}
        />
      </div>
    ));
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4" />
            Billing details
          </CardTitle>
          <CardDescription>
            Used when creating invoices for this company.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {fields([
            { key: "phone", label: "Company phone", type: "tel" },
            { key: "email", label: "Billing email", type: "email" },
          ])}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="billing-address">Billing address</Label>
            <Textarea
              id="billing-address"
              name="commerce.address"
              value={billingAddress}
              onChange={(event) => setBillingAddress(event.target.value)}
              placeholder="Street, building / unit, city, state / province, postal code, country"
              maxLength={2000}
            />
          </div>
          {fields([
            { key: "taxId", label: "Tax / VAT number" },
            { key: "termsDays", label: "Payment terms (days)", type: "number" },
          ])}
          <div className="space-y-2">
            <Label htmlFor="billing-currency">
              Default order & invoice currency
            </Label>
            <Select name="commerce.currency" defaultValue={values.currency}>
              <SelectTrigger id="billing-currency" className="w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {invoiceCurrencies.map((currency) => (
                  <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-4" />
            Shipping & delivery
          </CardTitle>
          <CardDescription>
            Default delivery details for new purchase orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {fields([
            { key: "shippingRecipient", label: "Recipient / attention" },
            { key: "shippingPhone", label: "Delivery phone", type: "tel" },
          ])}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={sameAddress}
              onChange={(event) => setSameAddress(event.target.checked)}
            />
            Use billing address
          </label>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="shipping-address">Shipping address</Label>
            <Textarea
              id="shipping-address"
              name="commerce.shippingAddress"
              value={sameAddress ? billingAddress : shippingAddress}
              readOnly={sameAddress}
              onChange={(event) => setShippingAddress(event.target.value)}
              placeholder="Street, building / unit, city, state / province, postal code, country"
              maxLength={2000}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="shipping-notes">Delivery instructions</Label>
            <Textarea
              id="shipping-notes"
              name="commerce.shippingNotes"
              defaultValue={values.shippingNotes}
              placeholder="Receiving hours, courier preference, or access instructions"
              maxLength={2000}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
