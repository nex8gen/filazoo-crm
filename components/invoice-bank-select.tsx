"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { invoiceRequest } from "@/lib/invoice-client";
import { invoiceBankFields, type InvoiceBankAccount } from "@/lib/invoice-banks";
import type { InvoiceDocument } from "@/lib/invoices";

export function InvoiceBankSelect({ doc, onChange }: {
  doc: InvoiceDocument;
  onChange: Dispatch<SetStateAction<InvoiceDocument>>;
}) {
  const [accounts, setAccounts] = useState<InvoiceBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    invoiceRequest("/api/invoices/context?kind=banks", undefined, "GET", controller.signal)
      .then((result) => setAccounts(result.accounts))
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const mismatch = doc.bankAccount?.currency && doc.bankAccount.currency !== doc.currency;
  return (
    <div className="space-y-3">
      <label className="grid gap-2 text-sm">
        Receiving bank account
        <select value={doc.bankAccountId || ""} disabled={loading || !!error} onChange={(event) => {
          const account = accounts.find((item) => item.id === event.target.value);
          onChange((old) => ({ ...old, bankAccountId: account?.id, bankAccount: account }));
        }}>
          <option value="">{loading ? "Loading bank accounts…" : "No saved bank account / manual instructions"}</option>
          {doc.bankAccountId && !accounts.some((item) => item.id === doc.bankAccountId) ? <option value={doc.bankAccountId}>{doc.bankAccount?.label || "Previously selected account"}</option> : null}
          {accounts.map((account) => <option key={account.id} value={account.id} disabled={!!account.currency && account.currency !== doc.currency}>
            {account.label} · ending {account.accountNumber.slice(-4)}{account.currency && account.currency !== doc.currency ? ` · ${account.currency} invoices only` : ""}
          </option>)}
        </select>
      </label>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {mismatch ? <p role="alert" className="text-sm text-destructive">Choose an account for {doc.currency}, or remove the current selection.</p> : null}
      {doc.bankAccount ? <dl className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
        {invoiceBankFields(doc.bankAccount).map(([label, value]) => <div key={label} className="grid gap-1 sm:grid-cols-[8rem_1fr]"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}
      </dl> : null}
      {doc.bankAccount && !doc.bankAccount.currency ? <p className="text-xs text-muted-foreground">This account’s currency was not specified in the supplied bank details.</p> : null}
      <p className="text-xs text-muted-foreground">The selected bank details are saved on this invoice. Currency amounts are never converted automatically.</p>
    </div>
  );
}
