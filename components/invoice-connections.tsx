"use client";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Button } from "@/components/ui/button";
import { invoiceRequest } from "@/lib/invoice-client";
import { formatMoney, type InvoiceDocument } from "@/lib/invoices";
import {
  withBillingCustomer,
  productInvoiceLine,
  productUnitPrice,
  type BillingCustomer,
  type BillingProfile,
  type InvoiceProduct,
} from "@/lib/invoice-links";

type Billing = {
  customer: BillingCustomer;
  profile: BillingProfile | null;
  catalogs: {
    id: string;
    version: number;
    currency: string;
    product_skus: string[];
    price_date: string;
  }[];
};
export function InvoiceConnections({
  doc,
  onChange,
  onProducts,
  onBusyChange,
}: {
  doc: InvoiceDocument;
  onChange: Dispatch<SetStateAction<InvoiceDocument>>;
  onProducts: (products: InvoiceProduct[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPage, setCustomerPage] = useState(0);
  const [customers, setCustomers] = useState<BillingCustomer[]>([]);
  const [customerCount, setCustomerCount] = useState(0);
  const [productSearch, setProductSearch] = useState("");
  const [productPage, setProductPage] = useState(0);
  const [products, setProducts] = useState<InvoiceProduct[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>(
    {},
  );
  const [billing, setBilling] = useState<Billing | null>(null);
  const [termsDays, setTermsDays] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const latestDocument = useRef(doc);
  useEffect(() => {
    latestDocument.current = doc;
  }, [doc]);
  // Fetch identifiers in existing drafts as well as the current search page.
  const linkedSkus = JSON.stringify(
    [
      ...new Set(
        doc.items.flatMap((item) => (item.productSku ? [item.productSku] : [])),
      ),
    ].sort(),
  );
  useEffect(() => {
    if (linkedSkus === "[]") return;
    const controller = new AbortController();
    invoiceRequest(
      `/api/invoices/context?kind=products&skus=${encodeURIComponent(linkedSkus)}`,
      undefined,
      "GET",
      controller.signal,
    )
      .then((result) => onProducts(result.products))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [linkedSkus, onProducts]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      invoiceRequest(
        `/api/invoices/context?kind=customers&page=${customerPage}&search=${encodeURIComponent(customerSearch)}`,
        undefined,
        "GET",
        controller.signal,
      )
        .then((result) => {
          setCustomers(result.customers);
          setCustomerCount(result.count);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(err.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [customerSearch, customerPage]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      invoiceRequest(
        `/api/invoices/context?kind=products&page=${productPage}&search=${encodeURIComponent(productSearch)}&currency=${doc.currency}`,
        undefined,
        "GET",
        controller.signal,
      )
        .then((result) => {
          setProducts(result.products);
          setProductCount(result.count);
          onProducts(result.products);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(err.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [productSearch, productPage, doc.currency, onProducts]);
  useEffect(() => {
    if (!doc.companyId) return;
    const controller = new AbortController();
    invoiceRequest(
      `/api/invoices/context?kind=customer&companyId=${doc.companyId}`,
      undefined,
      "GET",
      controller.signal,
    )
      .then((result) => {
        setBilling(result);
        setTermsDays(result.profile?.termsDays ?? 0);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [doc.companyId]);
  const currentBilling =
    billing?.customer.id === doc.companyId ? billing : null;
  async function chooseCustomer(companyId: string) {
    if (!companyId) {
      onChange({
        ...doc,
        companyId: undefined,
        contactId: undefined,
        customerName: "",
        customerEmail: "",
        customerAddress: "",
        customerTaxId: "",
        sourceThreadId: undefined,
      });
      setBilling(null);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result: Billing = await invoiceRequest(
        `/api/invoices/context?kind=customer&companyId=${companyId}`,
      );
      setBilling(result);
      setTermsDays(result.profile?.termsDays ?? 0);
      onChange((current) => ({
        ...withBillingCustomer(current, result.customer, result.profile),
        sourceThreadId: undefined,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load customer.");
    } finally {
      setBusy(false);
    }
  }
  function addProduct(product: InvoiceProduct, variantId?: string) {
    const line = productInvoiceLine(product, product.moq, variantId);
    if (doc.items.length >= 100 && doc.items.some((item) => item.description)) {
      setError("Invoices support up to 100 items.");
      return;
    }
    onChange((current) => ({
      ...current,
      items:
        current.items.length === 1 && !current.items[0].description
          ? [line]
          : [...current.items, line],
    }));
    setNotice(
      `${line.description} added.${line.pricingMode === "manual" ? " Enter an agreed unit price; no catalog quote is available." : " Quantity pricing updates automatically."}`,
    );
  }
  async function saveProfile(kind: "customer" | "seller") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await invoiceRequest(
        "/api/invoices/billing",
        kind === "customer"
          ? {
              kind,
              companyId: doc.companyId,
              profile: {
                address: doc.customerAddress,
                taxId: doc.customerTaxId,
                email: doc.customerEmail,
                currency: doc.currency,
                termsDays,
              },
            }
          : {
              kind,
              settings: {
                sellerName: doc.sellerName,
                sellerAddress: doc.sellerAddress,
                sellerTaxId: doc.sellerTaxId,
                paymentInstructions: doc.paymentInstructions,
                notes: doc.notes,
              },
            },
        "PUT",
      );
      setNotice(
        kind === "customer"
          ? "Customer billing defaults saved for future invoices."
          : "Business defaults saved for future invoices.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save billing defaults.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function importCatalog(catalog: Billing["catalogs"][number]) {
    if (catalog.currency.trim() !== doc.currency) {
      setError(
        `This catalog uses ${catalog.currency}. Change the empty invoice currency first.`,
      );
      return;
    }
    if (!catalog.product_skus.length) {
      setError("This catalog is empty.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await invoiceRequest(
        `/api/invoices/context?kind=products&skus=${encodeURIComponent(JSON.stringify(catalog.product_skus.slice(0, 100)))}&currency=${doc.currency}`,
      );
      const found = result.products as InvoiceProduct[];
      const current = latestDocument.current;
      if (current.currency !== catalog.currency.trim())
        throw new Error(
          "Invoice currency changed while the catalog loaded. Choose the catalog again.",
        );
      const existing = current.items.filter((item) => item.description);
      const added = found.map((product) =>
        productInvoiceLine(product, product.moq),
      );
      if (existing.length + added.length > 100)
        throw new Error("Adding this catalog would exceed 100 invoice lines.");
      onProducts(found);
      onChange({ ...current, items: [...existing, ...added] });
      setNotice(
        `${added.length} products added at current catalog prices. Select variants where needed.${catalog.product_skus.length !== added.length ? " Some unavailable, mismatched-currency, or excess products were skipped." : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load catalog.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5 rounded-xl border bg-muted/20 p-5">
      <div>
        <h2 className="font-semibold">Connected customer & products</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Search your CRM. Billing details and catalog prices are copied into
          this draft for review.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="grid gap-2 text-sm">
            Find a customer by company or email
            <input
              type="search"
              autoComplete="off"
              name="invoice-customer-lookup"
              value={customerSearch}
              placeholder="Search all CRM customers"
              onChange={(event) => {
                setCustomerSearch(event.target.value);
                setCustomerPage(0);
              }}
            />
          </label>
          <label className="grid gap-2 text-sm">
            CRM customer
            <Select value={doc.companyId ?? ""} disabled={busy} onValueChange={(value) => { if (value === null) return; return void chooseCustomer(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="">Custom customer / no CRM link</SelectItem>
              {doc.companyId &&
              !customers.some((item) => item.id === doc.companyId) ? (
                <SelectItem value={doc.companyId}>
                  {currentBilling?.customer.name ?? doc.customerName} (selected)
                </SelectItem>
              ) : null}
              {customers.map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.name} · {customer.contacts[0]?.email ?? "No email"}
                </SelectItem>
              ))}
            </SelectContent></Select>
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={customerPage === 0}
              onClick={() => setCustomerPage((value) => value - 1)}
            >
              Previous customers
            </Button>
            <span>{customerCount} customers</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={(customerPage + 1) * 25 >= customerCount}
              onClick={() => setCustomerPage((value) => value + 1)}
            >
              Next customers
            </Button>
          </div>
          {currentBilling ? (
            <>
              <label className="grid gap-2 text-sm">
                Billing contact
                <Select value={doc.contactId ?? ""} onValueChange={(value) => { if (value === null) return;
                    const contact = currentBilling.customer.contacts.find(
                      (item) => item.id === value,
                    );
                    onChange({
                      ...doc,
                      contactId: contact?.id,
                      customerEmail: contact?.email ?? doc.customerEmail,
                    });
                   }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="">Company billing / custom email</SelectItem>
                  {currentBilling.customer.contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.name || contact.email} · {contact.email}
                    </SelectItem>
                  ))}
                </SelectContent></Select>
              </label>
              <Link
                href={`/companies/${doc.companyId}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline"
              >
                Open customer profile
              </Link>
            </>
          ) : null}
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium">Reusable billing details</p>
          <p className="text-xs leading-5 text-muted-foreground">
            Edit the business and billing fields below, then save them here to
            reuse on future invoices. Existing invoices keep their original
            details.
          </p>
          <label className="grid gap-2 text-sm">
            Default payment terms (days)
            <input
              type="number"
              min="0"
              max="365"
              step="1"
              value={termsDays}
              onChange={(event) => setTermsDays(Number(event.target.value))}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !doc.companyId}
              onClick={() => void saveProfile("customer")}
            >
              Save customer billing defaults
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void saveProfile("seller")}
            >
              Save business defaults
            </Button>
          </div>
          {doc.sourceThreadId ? (
            <p className="text-xs text-muted-foreground">
              Created from an email conversation.{" "}
              <Link
                href={`/emails?thread=${encodeURIComponent(doc.sourceThreadId)}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                Open conversation
              </Link>
            </p>
          ) : null}
          {currentBilling?.catalogs.length ? (
            <label className="grid gap-2 text-sm">
              Add from this customer’s saved catalog
              <Select value="" disabled={busy} onValueChange={(value) => { if (value === null) return;
                  const catalog = currentBilling.catalogs.find(
                    (item) => item.id === value,
                  );
                  if (catalog) void importCatalog(catalog);
                 }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="">Choose a catalog to add its products</SelectItem>
                {currentBilling.catalogs.map((catalog) => (
                  <SelectItem key={catalog.id} value={catalog.id}>
                    v{catalog.version} · {catalog.currency} ·{" "}
                    {catalog.price_date} · {catalog.product_skus.length}{" "}
                    products
                  </SelectItem>
                ))}
              </SelectContent></Select>
            </label>
          ) : null}
        </div>
      </div>
      <label className="grid gap-2 text-sm">
        Find products ({doc.currency})
        <input
          type="search"
          autoComplete="off"
          name="invoice-product-lookup"
          value={productSearch}
          placeholder="Search product name or SKU"
          onChange={(event) => {
            setProductSearch(event.target.value);
            setProductPage(0);
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Choose a variant, then click Add product. Products already on this
        invoice stay marked below.
      </p>
      <div className="max-h-72 space-y-2 overflow-y-auto" aria-busy={loading}>
        {products.map((product) => {
          const selectedVariant = product.variants.find(
            (variant) => variant.id === selectedVariants[product.sku],
          );
          const addedItems = doc.items.filter(
            (item) => item.productSku === product.sku,
          );
          const selectedAdded = addedItems.some(
            (item) => item.variantId === selectedVariant?.id,
          );
          const price = productUnitPrice(product, product.moq, selectedVariant?.id);
          const addedVariants = new Map<
            string,
            { name: string; quantity: number }
          >();
          for (const item of addedItems) {
            const key = item.variantId ?? "";
            const existing = addedVariants.get(key);
            addedVariants.set(key, {
              name: item.variantId
                ? product.variants.find((variant) => variant.id === item.variantId)
                    ?.name || item.variantSku || item.description
                : "Base product",
              quantity: (existing?.quantity ?? 0) + item.quantity,
            });
          }
          return (
            <div
              key={product.sku}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 transition-colors ${
                addedItems.length
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : selectedVariant
                    ? "border-primary/50 bg-primary/5"
                    : "bg-background"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{product.name}</p>
                  {addedItems.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <Check className="size-3" aria-hidden="true" />
                      Added to invoice
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedVariant?.sku || product.sku} · MOQ {product.moq} ·{" "}
                  {price === null
                    ? "Price on request"
                    : formatMoney(price, product.currency)}{" "}
                  · {selectedVariant?.stockStatus || product.stockStatus}
                </p>
                {product.tiers.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {product.tiers
                      .map(
                        (tier) =>
                          `${tier.minimumQuantity}+: ${formatMoney(tier.priceMinor, product.currency)}`,
                      )
                      .join(" · ")}
                  </p>
                ) : null}
                {selectedVariant && (
                  <p role="status" className="mt-2 text-xs font-medium text-primary">
                    Selected: {selectedVariant.name} · {selectedVariant.sku}
                    {!selectedAdded && " · Ready to add"}
                  </p>
                )}
                {addedVariants.size > 0 && (
                  <ul aria-label={`${product.name} items on invoice`} className="mt-2 flex flex-wrap gap-2">
                    {Array.from(addedVariants, ([key, item]) => (
                      <li key={key} className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-background px-2 py-1 text-xs text-emerald-700 dark:text-emerald-400">
                        <Check className="size-3" aria-hidden="true" />
                        {item.name} · Qty {item.quantity}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-2">
                {product.variants.length ? (
                  <Select
                    value={selectedVariant?.id ?? ""}
                    onValueChange={(value) => {
                      if (value === null) return;
                      setSelectedVariants((current) => ({ ...current, [product.sku]: value }));
                    }}
                  >
                    <SelectTrigger aria-label={`Variant of ${product.name}`} className="w-60 max-w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Choose variant (optional)</SelectItem>
                      {product.variants.map((variant) => (
                        <SelectItem key={variant.id} value={variant.id}>
                          {variant.name} · {variant.sku}
                          {addedItems.some((item) => item.variantId === variant.id) && " · Added"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={doc.items.length >= 100}
                  onClick={() => addProduct(product, selectedVariant?.id)}
                >
                  {selectedAdded ? <><Check aria-hidden="true" /> Add again</> : "Add product"}
                </Button>
              </div>
            </div>
          );
        })}
        {!products.length && !loading ? (
          <p className="p-3 text-sm text-muted-foreground">
            No active products match this currency and search. You can add an
            agreed custom line below.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || productPage === 0}
          onClick={() => setProductPage((value) => value - 1)}
        >
          Previous products
        </Button>
        <span>
          {productCount} products · page {productPage + 1}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || (productPage + 1) * 25 >= productCount}
          onClick={() => setProductPage((value) => value + 1)}
        >
          Next products
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
