import { z } from "zod";

export const invoiceBankAccountSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  beneficiaryName: z.string().trim().min(1).max(200),
  beneficiaryAddress: z.string().trim().max(1000),
  accountNumber: z.string().trim().min(1).max(100),
  bankName: z.string().trim().min(1).max(200),
  bankAddress: z.string().trim().max(1000),
  swift: z.string().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/),
  bankCode: z.string().trim().max(30),
});
export type InvoiceBankAccount = z.infer<typeof invoiceBankAccountSchema>;

export function invoiceBankFields(account: InvoiceBankAccount, includeAddresses = true) {
  return [
    ["Beneficiary", account.beneficiaryName],
    ["Account number", account.accountNumber],
    ...(account.currency ? [["Account currency", account.currency]] : []),
    ["Bank", account.bankName],
    ["SWIFT / BIC", account.swift],
    ...(account.bankCode ? [["Bank code", account.bankCode]] : []),
    ...(includeAddresses ? [["Bank address", account.bankAddress], ["Beneficiary address", account.beneficiaryAddress]] : []),
  ].filter(([, value]) => value);
}
