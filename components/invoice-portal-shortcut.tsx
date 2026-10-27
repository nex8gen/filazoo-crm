"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { companyPortalHref } from "@/lib/company-portal";
export function InvoicePortalShortcut({ id, companyId, customerName, canWrite }: { id: string; companyId?: string | null; customerName: string; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(customerName);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState("");
  async function connect(input: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/invoices/${id}/customer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to connect the customer profile.");
      router.push(result.href);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function find(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/invoices/context?kind=customers&search=${encodeURIComponent(search)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to find customer profiles.");
      setCustomers(result.customers); setTarget("");
      if (!result.customers.length) setError("No matching customer profile found.");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="invoice-customer-tools space-y-3 rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><MessageCircle className="size-4" />Customer portal</h2><p className="mt-1 text-sm text-muted-foreground">Manage conversations and shipping from the connected customer profile.</p></div>{companyId ? <Link href={companyPortalHref(companyId, id)} className="text-sm font-medium text-primary underline">Manage in customer profile</Link> : canWrite && <Button disabled={busy} onClick={() => void connect({ action: "create-profile" })}>Create customer profile</Button>}</div>{!companyId && canWrite && <details><summary className="cursor-pointer text-sm text-primary">Connect to an existing customer</summary><form onSubmit={find} className="mt-3 flex gap-2"><Input aria-label="Find customer profile" value={search} onChange={event => setSearch(event.target.value)} placeholder="Company name or billing email" /><Button type="submit" variant="outline" disabled={busy}>Search</Button></form>{customers.length > 0 && <div className="mt-3 flex flex-wrap gap-2"><Select value={target} onValueChange={(selectedValue) => { if (selectedValue === null) return; setTarget(selectedValue); }}><SelectTrigger aria-label="Customer profile" className="min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="">Choose customer profile</SelectItem>{customers.map(customer => <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>)}</SelectContent></Select><Button disabled={busy || !target} onClick={() => void connect({ action: "link-profile", companyId: target })}>Connect invoice</Button></div>}</details>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</section>;
}
