"use client";

import { Truck, CreditCard } from "lucide-react";
import { commerceDefaults, type CompanyCommerce } from "@/lib/company-commerce";
import { invoiceCurrencies } from "@/lib/invoices";
import { CompanyInlineField, CompanyProfileSection } from "@/components/company-profile-fields";

export function CompanyCommerceFields({ profile, companyId, canWrite }: {
  profile?: CompanyCommerce; companyId: string; canWrite: boolean;
}) {
  const values = commerceDefaults(profile);
  const fieldProps = { companyId, canWrite };

  return <>
    <CompanyProfileSection title="Billing details" icon={CreditCard}>
      <CompanyInlineField {...fieldProps} name="commerce.phone" label="Company phone" value={values.phone} />
      <CompanyInlineField {...fieldProps} name="commerce.email" label="Billing email" value={values.email} />
      <CompanyInlineField {...fieldProps} name="commerce.address" label="Billing address" value={values.address} className="company-property-wide" important />
      <CompanyInlineField {...fieldProps} name="commerce.taxId" label="Tax / VAT number" value={values.taxId} />
      <CompanyInlineField {...fieldProps} name="commerce.termsDays" label="Payment terms (days)" value={String(values.termsDays)} />
      <CompanyInlineField {...fieldProps} name="commerce.currency" label="Default currency" value={values.currency} options={invoiceCurrencies} important />
    </CompanyProfileSection>

    <CompanyProfileSection title="Shipping details" icon={Truck}>
      <CompanyInlineField {...fieldProps} name="commerce.shippingRecipient" label="Recipient / attention" value={values.shippingRecipient} />
      <CompanyInlineField {...fieldProps} name="commerce.shippingPhone" label="Delivery phone" value={values.shippingPhone} />
      <CompanyInlineField {...fieldProps} name="commerce.shippingAddress" label="Shipping address" value={values.shippingAddress} className="company-property-wide" suggestedValue={values.address} important />
      <CompanyInlineField {...fieldProps} name="commerce.shippingNotes" label="Delivery instructions" value={values.shippingNotes} className="company-property-wide" />
    </CompanyProfileSection>
  </>;
}
