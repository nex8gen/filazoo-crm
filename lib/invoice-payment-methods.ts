import { z } from "zod";

export const paymentMethodLabels = {
  bank_transfer: "Bank transfer",
  paypal: "PayPal",
  other: "Other",
} as const;

export const paymentBankDetailsSchema = z.object({
  beneficiaryName: z.string().trim().min(1, "Enter the beneficiary name.").max(200),
  accountNumber: z.string().trim().min(1, "Enter the bank account number.").max(100),
  swift: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "Enter a valid 8 or 11 character SWIFT / BIC code."),
  bankName: z.string().trim().min(1, "Enter the bank name.").max(200),
});

export const invoicePaymentMethodSchema = z.object({
  id: z.uuid(),
  type: z.enum(["bank_transfer", "paypal", "other"]),
  label: z.string().trim().min(1, "Enter a payment method name.").max(100),
  currency: z.union([z.enum(["USD", "EUR", "GBP", "CNY", "CAD", "AUD", "HKD"]), z.literal("")]),
  details: z.string().trim().max(2000),
  bankDetails: paymentBankDetailsSchema.optional(),
  paymentUrl: z.union([
    z.url().max(1000).refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    }, "Use an HTTPS payment link without a username or password."),
    z.literal(""),
  ]),
}).superRefine((method, ctx) => {
  if (!method.details && !(method.type === "bank_transfer" && method.bankDetails) && (method.type === "bank_transfer" || !method.paymentUrl)) {
    ctx.addIssue({ code: "custom", path: ["details"], message: "Enter payment details so customers know how to pay." });
  }
});

export const invoicePaymentMethodsSchema = z.array(invoicePaymentMethodSchema).max(10).superRefine((methods, ctx) => {
  if (new Set(methods.map((method) => method.id)).size !== methods.length) {
    ctx.addIssue({ code: "custom", message: "Payment methods must have unique IDs." });
  }
});

export type InvoicePaymentMethod = z.infer<typeof invoicePaymentMethodSchema>;

export function paymentMethodTitle(method: InvoicePaymentMethod) {
  const type = paymentMethodLabels[method.type];
  return method.label === type ? type : `${method.label} (${type})`;
}

export function paymentMethodDetails(method: InvoicePaymentMethod) {
  const bank = method.type === "bank_transfer" ? method.bankDetails : undefined;
  return [
    ...(bank ? [`Beneficiary: ${bank.beneficiaryName}`, `Account number: ${bank.accountNumber}`, `SWIFT / BIC: ${bank.swift}`, `Bank name: ${bank.bankName}`] : []),
    method.details,
  ].filter(Boolean).join("\n");
}
