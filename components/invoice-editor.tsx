"use client";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InvoiceConnections } from "@/components/invoice-connections";
import { InvoicePaymentSelect } from "@/components/invoice-payment-select";
import { productUnitPrice, type InvoiceProduct } from "@/lib/invoice-links";
import {
  invoiceCurrencies,
  invoiceDocumentSchema,
  invoiceTotals,
  formatMoney,
  type InvoiceDocument,
} from "@/lib/invoices";

export function InvoiceEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: InvoiceDocument;
  busy: boolean;
  onSave: (doc: InvoiceDocument) => Promise<void>;
  onCancel: () => void;
}) {
  const [doc, setDoc] = useState(initial);
  const [error, setError] = useState("");
  const [connectionsBusy, setConnectionsBusy] = useState(false);
  const productCache = useRef(new Map<string, InvoiceProduct>());
  const rememberProducts = useCallback((products: InvoiceProduct[]) => {
    for (const product of products)
      productCache.current.set(product.sku, product);
  }, []);
  function field<K extends keyof InvoiceDocument>(
    key: K,
    value: InvoiceDocument[K],
  ) {
    if (
      key === "currency" &&
      value !== doc.currency &&
      doc.items.some((item) => item.productSku)
    ) {
      setError(
        "Remove or unlink catalog products before changing currency. Prices are never converted automatically.",
      );
      return;
    }
    setDoc((old) => ({ ...old, [key]: value }));
  }
  function itemField(
    index: number,
    key: keyof InvoiceDocument["items"][number],
    value: string | number,
  ) {
    setDoc((old) => ({
      ...old,
      items: old.items.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [key]: value };
        if (key === "unitPriceMinor" && item.productSku)
          updated.pricingMode = "manual";
        if (
          key === "quantity" &&
          item.productSku &&
          item.pricingMode === "catalog"
        ) {
          const product = productCache.current.get(item.productSku);
          if (product) {
            const price = productUnitPrice(
              product,
              Number(value),
              item.variantId,
            );
            if (price !== null) updated.unitPriceMinor = price;
          }
        }
        return updated;
      }),
    }));
  }
  const totals = invoiceTotals(doc);
  const textField = (
    label: string,
    key:
      | "sellerName"
      | "sellerTaxId"
      | "customerName"
      | "customerEmail"
      | "customerTaxId"
      | "issueDate"
      | "dueDate"
      | "reference",
    type = "text",
    required = false,
  ) => (
    <label className="grid gap-2 text-sm">
      {label}
      {type === "date" ? <DatePicker value={doc[key]} required={required} onValueChange={value => field(key, value)} /> : <input
        type={type}
        value={doc[key]}
        required={required}
        maxLength={key.includes("TaxId") ? 100 : 200}
        onChange={(event) => field(key, event.target.value)}
      />}
    </label>
  );
  const areaField = (
    label: string,
    key: "sellerAddress" | "customerAddress" | "paymentInstructions" | "notes",
  ) => (
    <label className="grid gap-2 text-sm">
      {label}
      <textarea
        rows={3}
        maxLength={key === "notes" ? 4000 : 2000}
        value={doc[key]}
        onChange={(event) => field(key, event.target.value)}
      />
    </label>
  );
  return (
    <form
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault();
        if (connectionsBusy) {
          setError(
            "Wait for customer and catalog changes to finish before saving.",
          );
          return;
        }
        const parsed = invoiceDocumentSchema.safeParse(doc);
        if (!parsed.success) {
          setError(
            parsed.error.issues[0]?.message ?? "Check the invoice fields.",
          );
          return;
        }
        setError("");
        await onSave(parsed.data);
      }}
      className="space-y-7"
    >
      <fieldset disabled={busy} className="space-y-7 disabled:opacity-60">
        {doc.purchaseOrderId && <p className="rounded-lg border bg-muted/30 p-4 text-sm">This invoice is linked to customer PO {doc.reference}. Keep its customer, currency, descriptions, and agreed unit prices unchanged. Reduce quantities or remove lines for partial billing; remaining quantities can be invoiced from the order.</p>}
        <fieldset disabled={Boolean(doc.purchaseOrderId)}><InvoiceConnections
          doc={doc}
          onChange={setDoc}
          onProducts={rememberProducts}
          onBusyChange={setConnectionsBusy}
        /></fieldset>
        <div className="grid gap-6 lg:grid-cols-2">
          {(["seller", "customer"] as const).map((party) => (
            <section key={party} className="space-y-4 rounded-xl border p-5">
              <h2 className="font-semibold">
                {party === "seller" ? "Your business" : "Bill to"}
              </h2>
              {textField(
                party === "seller"
                  ? "Business name"
                  : "Customer / company name",
                party === "seller" ? "sellerName" : "customerName",
                "text",
                true,
              )}
              {party === "customer"
                ? textField("Customer email", "customerEmail", "email")
                : null}
              {areaField(
                "Billing address",
                party === "seller" ? "sellerAddress" : "customerAddress",
              )}
              {textField(
                "Tax / registration ID",
                party === "seller" ? "sellerTaxId" : "customerTaxId",
              )}
            </section>
          ))}
        </div>
        <section className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2 lg:grid-cols-4">
          {textField("Issue date", "issueDate", "date", true)}
          {textField("Due date", "dueDate", "date", true)}
          <label className="grid gap-2 text-sm">
            Currency
            <Select value={doc.currency} onValueChange={(value) => { if (value === null) return; return field(
                  "currency",
                  value as InvoiceDocument["currency"],
                ); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              {invoiceCurrencies.map((currency) => (
                <SelectItem key={currency} value={currency}>{currency}</SelectItem>
              ))}
            </SelectContent></Select>
          </label>
          {textField("Reference / purchase order", "reference")}
        </section>
        <section className="space-y-4 rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Line items</h2>
            <Button
              type="button"
              variant="outline"
              disabled={doc.items.length >= 100}
              onClick={() =>
                field("items", [
                  ...doc.items,
                  {
                    description: "",
                    quantity: 1,
                    unitPriceMinor: 0,
                    taxBps: 0,
                  },
                ])
              }
            >
              Add item
            </Button>
          </div>
          {doc.items.map((item, index) => (
            <div key={index} className="space-y-3 border-b pb-4">
              {item.productSku ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded border bg-muted px-2 py-1">
                    SKU: {item.variantSku || item.productSku} ·{" "}
                    {item.pricingMode === "catalog"
                      ? "Automatic quantity pricing"
                      : "Manual agreed price"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const product = productCache.current.get(
                        item.productSku!,
                      );
                      const price = product
                        ? productUnitPrice(
                            product,
                            item.quantity,
                            item.variantId,
                          )
                        : null;
                      if (price === null) {
                        setError(
                          "No current catalog quote is available. Enter an agreed manual price.",
                        );
                        return;
                      }
                      field(
                        "items",
                        doc.items.map((line, i) =>
                          i === index
                            ? {
                                ...line,
                                unitPriceMinor: price,
                                pricingMode: "catalog",
                              }
                            : line,
                        ),
                      );
                    }}
                  >
                    Refresh catalog price
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      field(
                        "items",
                        doc.items.map((line, i) =>
                          i === index
                            ? {
                                ...line,
                                productSku: undefined,
                                variantId: undefined,
                                variantSku: undefined,
                                imageUrl: undefined,
                                pricingMode: undefined,
                              }
                            : line,
                        ),
                      )
                    }
                  >
                    Unlink / custom line
                  </Button>
                </div>
              ) : null}
              <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[3fr_1fr_1.5fr_1fr_auto]">
                <label className="grid gap-2 text-sm">
                  Description
                  <input
                    required
                    maxLength={500}
                    value={item.description}
                    onChange={(event) =>
                      itemField(index, "description", event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Quantity
                  <input
                    type="number"
                    required
                    min="1"
                    max="1000000"
                    step="1"
                    value={item.quantity}
                    onChange={(event) =>
                      itemField(index, "quantity", Number(event.target.value))
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Unit price ({doc.currency})
                  <input
                    type="number"
                    required
                    min="0"
                    max="1000000"
                    step="0.01"
                    value={item.unitPriceMinor / 100}
                    onChange={(event) =>
                      itemField(
                        index,
                        "unitPriceMinor",
                        Math.round(Number(event.target.value) * 100),
                      )
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Tax %
                  <input
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="0.01"
                    value={item.taxBps / 100}
                    onChange={(event) =>
                      itemField(
                        index,
                        "taxBps",
                        Math.round(Number(event.target.value) * 100),
                      )
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={doc.items.length === 1}
                  onClick={() =>
                    field(
                      "items",
                      doc.items.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Discount is allocated across items before tax. Shipping is untaxed.
            Quantities are whole units.
          </p>
        </section>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4 rounded-xl border p-5">
            <InvoicePaymentSelect doc={doc} onChange={setDoc} />
            {areaField(
              "Additional payment instructions / manual bank details",
              "paymentInstructions",
            )}
            {areaField("Notes & payment terms", "notes")}
          </section>
          <section className="space-y-4 rounded-xl border p-5">
            {(["discountMinor", "shippingMinor"] as const).map((key) => (
              <label key={key} className="grid gap-2 text-sm">
                {key === "discountMinor" ? "Discount" : "Shipping"} (
                {doc.currency})
                <input
                  type="number"
                  required
                  min="0"
                  max="1000000"
                  step="0.01"
                  value={doc[key] / 100}
                  onChange={(event) =>
                    field(key, Math.round(Number(event.target.value) * 100))
                  }
                />
              </label>
            ))}
            <dl className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
              <dt>Subtotal</dt>
              <dd className="text-right">
                {formatMoney(totals.subtotal, doc.currency)}
              </dd>
              <dt>Tax</dt>
              <dd className="text-right">
                {formatMoney(totals.tax, doc.currency)}
              </dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right text-xl font-semibold">
                {formatMoney(totals.total, doc.currency)}
              </dd>
            </dl>
          </section>
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={busy || connectionsBusy}>
          {busy ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </form>
  );
}
