"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ClipboardList, X } from "lucide-react";
import {
  listCompanyPurchaseOrders,
  savePurchaseOrder,
  createOrderInvoice,
  getPurchaseOrderProfile,
  loadPurchaseOrderProducts,
} from "@/app/purchase-order-actions";
import {
  poStatuses,
  poStatusLabels,
  purchaseOrderTotal,
  orderBillingSummary,
  orderHasUnreservedItems,
  type PurchaseOrder,
  type PurchaseOrderDocument,
  type OrderProfile,
} from "@/lib/purchase-orders";
import { commerceDefaults, type CompanyCommerce } from "@/lib/company-commerce";
import { applyOrderProfile, customOrderLine, orderProductLine, refreshOrderProductLine } from "@/lib/purchase-order-links";
import { productUnitPrice, type InvoiceProduct } from "@/lib/invoice-links";
import { PurchaseOrderProductPicker } from "@/components/purchase-order-product-picker";
import { PurchaseOrderProfileFields } from "@/components/purchase-order-profile-fields";
import { formatMoney, invoiceCurrencies, invoiceLabel } from "@/lib/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

type Result = { orders: PurchaseOrder[]; count: number };
const blankItem = () => ({
  description: "",
  sku: "",
  quantity: 1,
  unitPriceMinor: 0,
});

export function PurchaseOrderWorkspace({
  companyId,
  companyName,
  commerce,
  canWrite,
  initial,
  profile: initialProfile,
  catalogAvailability,
  focusedOrderId,
}: {
  companyId: string;
  companyName: string;
  commerce?: CompanyCommerce;
  canWrite: boolean;
  initial: Result;
  profile: OrderProfile;
  catalogAvailability: { currency: string; count: number }[];
  focusedOrderId?: string;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [result, setResult] = useState(initial);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<PurchaseOrder | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const load = (nextPage: number) =>
    startTransition(async () => {
      try {
        setResult(await listCompanyPurchaseOrders(companyId, nextPage, focusedOrderId));
        setPage(nextPage);
        setError("");
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Unable to load orders.",
        );
      }
    });
  return (
    <section className="space-y-5">
      {focusedOrderId ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-4 py-3 text-xs"><span>Showing the selected purchase order.</span><Link className="font-medium text-primary underline" href={`/companies/${companyId}?tab=purchase-orders`}>View all customer orders</Link></div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Purchase orders</h2>
          <p className="text-sm text-muted-foreground">
            Customer POs received from {companyName}. Track items, delivery, and
            fulfillment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setEditing(null);
              load(page);
            }}
          >
            Refresh orders
          </Button>
          {canWrite && (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    setProfile(await getPurchaseOrderProfile(companyId));
                    setEditing("new");
                    setError("");
                  } catch {
                    setError(
                      "The saved company profile could not be loaded. Please try again.",
                    );
                  }
                })
              }
            >
              <Plus />
              Add purchase order
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <PurchaseOrderEditor
          key={editing === "new" ? "new" : `${editing.id}-${editing.version}`}
          companyId={companyId}
          order={editing === "new" ? null : editing}
          commerce={commerce}
          profile={profile}
          catalogAvailability={catalogAvailability}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load(0);
          }}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {[
                "PO number",
                "Order date",
                "Delivery date",
                "Status",
                "Total",
                "",
              ].map((title, i) => (
                <th key={i} className="whitespace-nowrap px-4 py-3 font-medium">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.orders.map((order) => (
              <tr key={order.id}>
                <td className="px-4 py-4 font-medium">
                  {order.document.reference}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  {order.document.orderDate}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  {order.document.deliveryDate || "Not scheduled"}
                </td>
                <td className="px-4 py-4">
                  <span className="whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs">
                    {poStatusLabels[order.document.status]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  {formatMoney(order.total_minor, order.document.currency)}
                </td>
                <td className="px-4 py-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setEditing(order)}
                  >
                    {canWrite ? "View / edit" : "View"}
                    <span className="sr-only"> {order.document.reference}</span>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!result.orders.length && (
          <div className="space-y-2 p-12 text-center">
            <ClipboardList className="mx-auto size-8 text-muted-foreground" />
            <h3 className="font-medium">No purchase orders yet</h3>
            <p className="text-sm text-muted-foreground">
              Record a customer PO to keep order details and delivery
              information together.
            </p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{result.count} purchase orders</span>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pending || page === 0}
            onClick={() => load(page - 1)}
          >
            Previous
          </Button>
          <span>Page {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || (page + 1) * 20 >= result.count}
            onClick={() => load(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

function PurchaseOrderEditor({
  companyId,
  order,
  commerce,
  profile: initialProfile,
  catalogAvailability,
  canWrite,
  onClose,
  onSaved,
}: {
  companyId: string;
  order: PurchaseOrder | null;
  commerce?: CompanyCommerce;
  profile: OrderProfile;
  catalogAvailability: { currency: string; count: number }[];
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [document, setDocument] = useState<PurchaseOrderDocument>(() => {
    const defaults = commerceDefaults(profile.commerce ?? commerce);
    if (order)
      return {
        ...order.document,
        customer: order.document.customer ?? profile.customer,
      };
    return applyOrderProfile(
      {
        reference: "",
        orderDate: new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Shanghai",
        }),
        deliveryDate: "",
        currency: defaults.currency,
        status: "draft",
        paymentPolicy: "full_before_shipment",
        preShipmentPercent: 100,
        paymentTerms: "",
        shippingAddress: defaults.shippingAddress,
        shippingRecipient: defaults.shippingRecipient,
        shippingPhone: defaults.shippingPhone,
        notes: defaults.shippingNotes,
        items: [blankItem()],
      },
      profile,
    );
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [savedDocument] = useState(document);
  const dirty = JSON.stringify(document) !== JSON.stringify(savedDocument);
  const [linkingIndex, setLinkingIndex] = useState<number | null>(null);
  const router = useRouter();
  const summary = order ? orderBillingSummary(order) : null;
  const locked = Boolean(
    order?.invoices?.some((invoice) => invoice.status !== "void"),
  );
  const [productCache, setProductCache] = useState(new Map<string, InvoiceProduct>());
  const linkedSkus = JSON.stringify(
    [
      ...new Set(
        document.items.flatMap((item) =>
          item.productSku ? [item.productSku] : [],
        ),
      ),
    ].sort(),
  );
  useEffect(() => {
    let cancelled = false;
    const skus = JSON.parse(linkedSkus) as string[];
    if (!skus.length) return;
    loadPurchaseOrderProducts(skus)
      .then((result) => {
        if (!cancelled)
          setProductCache((current) => {
            const next = new Map(current);
            for (const sku of skus) next.delete(sku);
            for (const product of result.products) next.set(product.sku, product);
            return next;
          });
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Some catalog products could not be refreshed. Retry before changing quantities.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [linkedSkus]);
  const change = <K extends keyof PurchaseOrderDocument>(
    key: K,
    value: PurchaseOrderDocument[K],
  ) => setDocument((current) => ({ ...current, [key]: value }));
  const changeItem = (
    index: number,
    patch: Partial<PurchaseOrderDocument["items"][number]>,
  ) =>
    setDocument((current) => ({
      ...current,
      items: current.items.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, ...patch };
        if (
          patch.quantity !== undefined &&
          item.pricingMode === "catalog" &&
          item.productSku
        ) {
          const product = productCache.get(item.productSku);
          const price = product
            ? productUnitPrice(product, patch.quantity, item.variantId)
            : null;
          if (price !== null) updated.unitPriceMinor = price;
        }
        if (patch.unitPriceMinor !== undefined && item.productSku)
          updated.pricingMode = "manual";
        return updated;
      }),
    }));
  const refreshProduct = (index: number, useCatalogPrice: boolean) =>
    startTransition(async () => {
      const item = document.items[index];
      try {
        const { products } = await loadPurchaseOrderProducts([item.productSku!]);
        const product = products[0];
        if (!product || product.currency !== document.currency)
          throw new Error("This product is unavailable in the order currency. Choose another product or convert the line to a custom item.");
        if (item.variantId && !product.variants.some((variant) => variant.id === item.variantId))
          throw new Error("This variant is no longer available. Use Change product to choose a current variant.");
        if (useCatalogPrice && productUnitPrice(product, item.quantity, item.variantId) === null)
          throw new Error("No current catalog quote is available. Enter an agreed unit price.");
        setProductCache((current) => new Map(current).set(product.sku, product));
        setDocument((current) => ({ ...current, items: current.items.map((line, i) =>
          i === index ? refreshOrderProductLine(item, product, useCatalogPrice) : line) }));
        setError("");
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to refresh product details.");
      }
    });
  const field = (
    key:
      | "reference"
      | "orderDate"
      | "deliveryDate"
      | "shippingRecipient"
      | "shippingPhone",
    label: string,
    type = "text",
    required = false,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`po-${key}`}>{label}</Label>
      {type === "date" ? <DatePicker id={`po-${key}`} required={required} value={document[key]} onValueChange={value => change(key, value)} /> : <Input
        id={`po-${key}`}
        type={type}
        required={required}
        value={document[key]}
        onChange={(event) => change(key, event.target.value)}
        maxLength={type === "text" ? 160 : undefined}
        readOnly={locked && key === "reference"}
      />}
    </div>
  );
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle>
            {order ? `PO ${order.document.reference}` : "New purchase order"}
          </CardTitle>
          <CardDescription>
            Amounts are in the selected currency. Order details are saved with
            this PO.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close purchase order"
          disabled={pending}
          onClick={onClose}
        >
          <X />
        </Button>
      </CardHeader>
      <CardContent>
        {order && summary && (
          <div className="mb-6 space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium">Linked invoices & payment</h3>
              {canWrite && (
                <Button
                  variant="outline"
                  disabled={
                    pending ||
                    dirty ||
                    !orderHasUnreservedItems(order) ||
                    ["draft", "cancelled"].includes(order.document.status)
                  }
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const result = await createOrderInvoice(
                          companyId,
                          order.id,
                        );
                        if (result.error) setError(result.error);
                        else if (result.invoiceId)
                          router.push(`/invoices/${result.invoiceId}`);
                      } catch {
                        setError("Unable to create invoice. Please try again.");
                      }
                    })
                  }
                >
                  Create invoice for remaining items
                </Button>
              )}
            </div>
            <p className="text-sm">
              Issued: {formatMoney(summary.total, order.document.currency)} ·
              Received: {formatMoney(summary.paid, order.document.currency)} ·
              Due: {formatMoney(summary.outstanding, order.document.currency)}
            </p>
            <p className="text-sm text-muted-foreground">
              Billing:{" "}
              {summary.fullyInvoiced
                ? "Fully invoiced"
                : summary.total
                  ? "Partially invoiced"
                  : "Not invoiced"}{" "}
              · Shipment:{" "}
              {summary.canShip
                ? "Payment requirement met"
                : "Awaiting invoice / required payment"}
            </p>
            {order.invoices?.map((invoice) => (
              <div
                key={invoice.id}
                className="flex flex-wrap justify-between gap-3 text-sm"
              >
                <Link
                  className="text-primary underline"
                  href={`/invoices/${invoice.id}`}
                >
                  {invoiceLabel(invoice)}
                </Link>
                <span>
                  {invoice.status} ·{" "}
                  {formatMoney(invoice.total_minor, order.document.currency)}
                  {invoice.status === "issued"
                    ? ` · ${formatMoney(invoice.paid_minor, order.document.currency)} paid`
                    : ""}
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Draft invoices reserve quantities. Issued invoices determine
              billing and payment status. Edit the linked draft for a partial
              invoice; create another invoice for the remaining items.
            </p>
            {dirty && <p className="text-sm text-muted-foreground">Save your order changes before creating an invoice.</p>}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              try {
                const result = await savePurchaseOrder(
                  companyId,
                  order?.id ?? null,
                  order?.version ?? 0,
                  document,
                );
                if (result.error) setError(result.error);
                else onSaved();
              } catch {
                setError(
                  "Unable to save. Check your connection and try again.",
                );
              }
            });
          }}
        >
          <fieldset disabled={pending || !canWrite} className="space-y-5">
            <PurchaseOrderProfileFields
              companyId={companyId}
              document={document}
              profile={profile}
              locked={locked}
              onChange={setDocument}
              onRefresh={() =>
                startTransition(async () => {
                  try {
                    const next = await getPurchaseOrderProfile(companyId);
                    setProfile(next);
                    setDocument((current) => applyOrderProfile(current, next, current.customer?.contactId));
                    setError("");
                  } catch {
                    setError(
                      "The saved profile could not be loaded. Save profile changes before refreshing.",
                    );
                  }
                })
              }
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {field("reference", "Customer PO number", "text", true)}
              {field("orderDate", "Order date", "date", true)}
              {field("deliveryDate", "Expected delivery", "date")}
              <div className="space-y-2">
                <Label htmlFor="po-currency">Currency</Label>
                <Select
                  disabled={
                    locked ||
                    document.items.some((item) => Boolean(item.productSku))
                  }
                  value={document.currency}
                  onValueChange={(value) => { if (value !== null) change("currency", value as PurchaseOrderDocument["currency"]); }}
                >
                  <SelectTrigger id="po-currency" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {invoiceCurrencies.map((currency) => (
                      <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-status">Order status</Label>
                <Select value={document.status} onValueChange={(value) => { if (value !== null) change("status", value as PurchaseOrderDocument["status"]); }}>
                  <SelectTrigger id="po-status" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {poStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {poStatusLabels[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="po-payment-policy">Payment policy</Label>
                <Select value={document.paymentPolicy} onValueChange={(value) => { if (value !== null) change("paymentPolicy", value as PurchaseOrderDocument["paymentPolicy"]); }}>
                  <SelectTrigger id="po-payment-policy" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_before_shipment">
                      100% payment before shipment
                    </SelectItem>
                    <SelectItem value="custom">Different agreed terms</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {document.paymentPolicy === "custom" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="po-payment-percent">
                      Required payment before shipment (%)
                    </Label>
                    <Input
                      id="po-payment-percent"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      required
                      value={document.preShipmentPercent}
                      onChange={(event) =>
                        change("preShipmentPercent", event.target.valueAsNumber)
                      }
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="po-payment-terms">
                      Agreed terms / reason for exception
                    </Label>
                    <Textarea
                      id="po-payment-terms"
                      required
                      maxLength={2000}
                      value={document.paymentTerms}
                      placeholder="Example: 30% before shipment; balance within 15 days of delivery."
                      onChange={(event) =>
                        change("paymentTerms", event.target.value)
                      }
                    />
                  </div>
                </>
              ) : (
                <p className="self-center text-sm text-muted-foreground">
                  Record full payment against the issued invoices before marking
                  this order shipped.
                </p>
              )}
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Order items</h3>
              {locked && (
                <p className="text-sm text-muted-foreground">
                  Products and commercial details are locked while linked
                  invoices exist.
                </p>
              )}
              <PurchaseOrderProductPicker
                currency={document.currency}
                catalogAvailability={catalogAvailability}
                title={linkingIndex === null ? "Add from product catalog" : `Choose product for item ${linkingIndex + 1}`}
                onCancel={linkingIndex === null ? undefined : () => setLinkingIndex(null)}
                disabled={locked || !canWrite || (document.items.length >= 100 && linkingIndex === null)}
                onAdd={(item, product) => {
                  setProductCache((current) => new Map(current).set(product.sku, product));
                  setDocument((current) => ({
                    ...current,
                    items:
                      linkingIndex !== null
                        ? current.items.map((line, index) => index === linkingIndex
                          ? { ...orderProductLine(product, line.quantity, item.variantId), unitPriceMinor: line.unitPriceMinor, pricingMode: "manual" as const }
                          : line)
                        : current.items.length === 1 &&
                      !current.items[0].description &&
                      !current.items[0].sku
                        ? [item]
                        : [...current.items, item],
                  }));
                  setLinkingIndex(null);
                }}
              />
              {document.items.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_90px_110px_100px_36px]"
                >
                  <div className="space-y-2">
                    <Label htmlFor={`po-description-${index}`}>
                      Product / description
                    </Label>
                    <Input
                      id={`po-description-${index}`}
                      required
                      maxLength={500}
                      readOnly={locked || Boolean(item.productSku)}
                      value={item.description}
                      onChange={(event) =>
                        changeItem(index, { description: event.target.value })
                      }
                    />
                    {item.imageUrl && <Image src={item.imageUrl} alt={item.description} width={48} height={48} unoptimized className="size-12 rounded-md border object-cover" />}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`po-sku-${index}`}>SKU</Label>
                    <Input
                      id={`po-sku-${index}`}
                      maxLength={200}
                      readOnly={locked || Boolean(item.productSku)}
                      value={item.sku}
                      onChange={(event) =>
                        changeItem(index, { sku: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`po-qty-${index}`}>Quantity</Label>
                    <Input
                      id={`po-qty-${index}`}
                      type="number"
                      required
                      min={1}
                      readOnly={locked || (item.pricingMode === "catalog" && !productCache.has(item.productSku!))}
                      max={1000000}
                      step={1}
                      value={Number.isNaN(item.quantity) ? "" : item.quantity}
                      onChange={(event) =>
                        changeItem(index, {
                          quantity: event.target.valueAsNumber,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`po-price-${index}`}>Unit price</Label>
                    <Input
                      id={`po-price-${index}`}
                      type="number"
                      required
                      min={0}
                      readOnly={locked}
                      max={1000000}
                      step="0.01"
                      value={
                        Number.isNaN(item.unitPriceMinor)
                          ? ""
                          : item.unitPriceMinor / 100
                      }
                      onChange={(event) =>
                        changeItem(index, {
                          unitPriceMinor: Math.round(
                            event.target.valueAsNumber * 100,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="self-end py-2 text-sm">
                    {formatMoney(
                      Number.isFinite(item.quantity * item.unitPriceMinor)
                        ? item.quantity * item.unitPriceMinor
                        : 0,
                      document.currency,
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="self-end"
                    aria-label={`Remove item ${index + 1}`}
                    disabled={locked}
                    onClick={() => {
                      setLinkingIndex(null);
                      change(
                        "items",
                        document.items.length === 1 ? [blankItem()] : document.items.filter((_, i) => i !== index),
                      );
                    }}
                  >
                    <Trash2 />
                  </Button>
                  {item.productSku && (
                    <div className="flex flex-wrap items-center gap-3 text-xs sm:col-span-2 lg:col-span-6">
                      <span className="text-muted-foreground">
                        Linked to Products ·{" "}
                        {item.variantSku || item.productSku} ·{" "}
                        {item.pricingMode === "catalog"
                          ? "Catalog quantity pricing"
                          : "Agreed manual price"}
                      </span>
                      {!locked && canWrite && <>
                        <Button type="button" size="sm" variant="ghost" onClick={() => refreshProduct(index, true)}>Use catalog price</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => refreshProduct(index, false)}>Refresh details, keep agreed price</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setLinkingIndex(index)}>Change product</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => {
                          setLinkingIndex(null);
                          change("items", document.items.map((line, i) => i === index ? customOrderLine(line) : line));
                        }}>Convert to custom item</Button>
                      </>}
                    </div>
                  )}
                  {!item.productSku && !locked && canWrite && <div className="flex flex-wrap items-center gap-3 text-xs sm:col-span-2 lg:col-span-6">
                    <span className="text-muted-foreground">Custom item · Not connected to Products</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setLinkingIndex(index)}>Connect to product</Button>
                    {linkingIndex === index && <span role="status">Choose a product in the catalog above. The quantity and agreed price will be kept.</span>}
                  </div>}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked || document.items.length >= 100}
                  onClick={() =>
                    change("items", [...document.items, blankItem()])
                  }
                >
                  <Plus />
                  Add custom item
                </Button>
                <p className="font-semibold">
                  Total{" "}
                  {formatMoney(
                    Number.isFinite(purchaseOrderTotal(document.items))
                      ? purchaseOrderTotal(document.items)
                      : 0,
                    document.currency,
                  )}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("shippingRecipient", "Ship to / attention")}
              {field("shippingPhone", "Delivery phone", "tel")}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="po-shipping">Shipping address</Label>
                <Textarea
                  id="po-shipping"
                  value={document.shippingAddress}
                  maxLength={2000}
                  onChange={(event) =>
                    change("shippingAddress", event.target.value)
                  }
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="po-notes">
                  Order notes & delivery instructions
                </Label>
                <Textarea
                  id="po-notes"
                  value={document.notes}
                  maxLength={5000}
                  onChange={(event) => change("notes", event.target.value)}
                />
              </div>
            </div>
            {canWrite && (
              <Button type="submit">
                {pending ? "Saving…" : "Save purchase order"}
              </Button>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
