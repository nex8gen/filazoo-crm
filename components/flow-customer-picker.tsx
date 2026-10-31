"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FlowCompany, FlowCustomer } from "@/lib/flow-customers";
import type { JsonConfig } from "@/lib/flows";

type OptionsResponse = { ok: boolean; companies?: FlowCompany[]; customers?: FlowCustomer[]; hasMore?: boolean; error?: string };

function useCustomerOptions(params: string | null) {
  const [result, setResult] = useState<{ key: string; data?: OptionsResponse; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!params) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/flows/customers?${params}`, { signal: controller.signal, cache: "no-store" });
        const data: OptionsResponse = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load customers.");
        if (!controller.signal.aborted) setResult({ key: params, data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key: params, error: error instanceof Error ? error.message : "Unable to load customers." });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [params, retry]);
  const current = result?.key === params ? result : null;
  return { data: current?.data, error: current?.error, loading: Boolean(params && !current), retry: () => { setResult(null); setRetry((value) => value + 1); } };
}

export function FlowCustomerPicker({ config, onChange, disabled }: { config: JsonConfig; onChange: (config: JsonConfig) => void; disabled: boolean }) {
  const restricted = "contactIds" in config;
  const selectedIds = Array.isArray(config.contactIds) ? config.contactIds.filter((id): id is string => typeof id === "string") : [];
  const [companySearch, setCompanySearch] = useState("");
  const [company, setCompany] = useState<FlowCompany | null>(null);
  const [companyOffset, setCompanyOffset] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOffset, setCustomerOffset] = useState(0);
  const companies = useCustomerOptions(restricted ? new URLSearchParams({ kind: "companies", query: companySearch, offset: String(companyOffset) }).toString() : null);
  const customers = useCustomerOptions(restricted && company ? new URLSearchParams({ companyId: company.id, query: customerSearch, offset: String(customerOffset) }).toString() : null);
  const selected = useCustomerOptions(restricted && selectedIds.length ? new URLSearchParams({ ids: selectedIds.join(",") }).toString() : null);
  const setIds = (ids: string[]) => onChange({ ...config, contactIds: ids });
  const setMode = (value: string | null) => {
    if (value === "selected") setIds([]);
    else if (value === "all") { const next = { ...config }; delete next.contactIds; onChange(next); }
  };
  const companyOptions = companies.data?.companies ?? [];
  const selectedById = new Map([...(selected.data?.customers ?? []), ...(customers.data?.customers ?? [])].map((customer) => [customer.id, customer]));

  return <section className="space-y-3 border-t pt-4" aria-label="Customer enrollment">
    <div><p className="text-xs font-semibold">Customers in this workflow</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose who can enter this workflow. Company filters must also match.</p></div>
    <Select value={restricted ? "selected" : "all"} onValueChange={setMode} disabled={disabled}>
      <SelectTrigger className="w-full" aria-label="Customer enrollment scope"><SelectValue>{restricted ? "Selected customers only" : "All matching customers"}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem value="all">All matching customers</SelectItem><SelectItem value="selected">Selected customers only</SelectItem></SelectContent>
    </Select>
    {restricted ? <>
      <div className="space-y-2">
        <Label htmlFor="flow-company-search">Find company</Label>
        <Input id="flow-company-search" placeholder="Search company name" value={companySearch} disabled={disabled} onChange={(event) => { setCompanySearch(event.target.value); setCompanyOffset(0); }} />
        <Select value={company?.id ?? ""} disabled={disabled || companies.loading} onValueChange={(id) => { const next = companyOptions.find((option) => option.id === id); if (next) { setCompany(next); setCustomerSearch(""); setCustomerOffset(0); } }}>
          <SelectTrigger className="w-full" aria-label="Choose company"><SelectValue placeholder="Choose a company">{company?.name}</SelectValue></SelectTrigger>
          <SelectContent>{company && !companyOptions.some((option) => option.id === company.id) ? <SelectItem value={company.id}>{company.name}</SelectItem> : null}{companyOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
        </Select>
        {companies.loading ? <p role="status" className="text-xs text-muted-foreground">Loading companies…</p> : !companies.error && !companyOptions.length ? <p className="text-xs text-muted-foreground">No companies found.</p> : null}
        {companies.error ? <LoadError message={companies.error} retry={companies.retry} /> : null}
        <OptionPages offset={companyOffset} hasMore={Boolean(companies.data?.hasMore)} onChange={setCompanyOffset} disabled={disabled || companies.loading} label="companies" />
      </div>
      {company ? <div className="space-y-2">
        <Label htmlFor="flow-customer-search">Customers at {company.name}</Label>
        <Input id="flow-customer-search" placeholder="Search customer name or email" value={customerSearch} disabled={disabled} onChange={(event) => { setCustomerSearch(event.target.value); setCustomerOffset(0); }} />
        <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2" aria-label="Company customers" aria-busy={customers.loading}>
          {customers.loading ? <p role="status" className="p-2 text-xs text-muted-foreground">Loading customers…</p> : null}
          {customers.error ? <LoadError message={customers.error} retry={customers.retry} /> : null}
          {!customers.loading && !customers.error && !customers.data?.customers?.length ? <p className="p-2 text-xs text-muted-foreground">No customers found at this company.</p> : null}
          {customers.data?.customers?.map((customer) => <label key={customer.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted/50">
            <Checkbox className="mt-0.5" checked={selectedIds.includes(customer.id)} disabled={disabled || (selectedIds.length >= 200 && !selectedIds.includes(customer.id))} onCheckedChange={(checked) => setIds(checked === true ? [...new Set([...selectedIds, customer.id])] : selectedIds.filter((id) => id !== customer.id))} />
            <span className="min-w-0"><span className="block break-words text-sm">{customer.name || customer.email}</span><span className="block break-all text-xs text-muted-foreground">{customer.email}</span></span>
          </label>)}
        </div>
        <OptionPages offset={customerOffset} hasMore={Boolean(customers.data?.hasMore)} onChange={setCustomerOffset} disabled={disabled || customers.loading} label="customers" />
      </div> : null}
      <div className="space-y-2">
        <p className="text-xs font-medium" aria-live="polite">{selectedIds.length} of 200 customers selected</p>
        {selectedIds.length ? <div className="max-h-52 space-y-2 overflow-y-auto">{selectedIds.map((id) => {
          const customer = selectedById.get(id);
          return <div key={id} className="flex items-start gap-2 rounded-lg bg-muted/50 p-2">
            <div className="min-w-0 flex-1 text-xs">{customer ? <><p className="font-medium">{customer.name || customer.email}</p><p className="break-all text-muted-foreground">{customer.email}</p><p className="text-muted-foreground">{customer.companyName}</p></> : <p>{selected.loading ? "Loading selected customer…" : selected.error ? "Unable to load selected customer" : "Customer unavailable — remove this selection"}</p>}</div>
            <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-label={`Remove ${customer?.name || customer?.email || "customer"}`} disabled={disabled} onClick={() => setIds(selectedIds.filter((value) => value !== id))}><X className="size-3.5" /></Button>
          </div>;
        })}</div> : <p className="text-xs text-destructive">Choose at least one customer before saving.</p>}
        {selected.error ? <LoadError message={selected.error} retry={selected.retry} /> : null}
        <p className="text-xs leading-5 text-muted-foreground">Only the selected customers’ email addresses can receive emails from this workflow. You can add customers from more than one company.</p>
      </div>
    </> : null}
  </section>;
}

function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="text-xs text-destructive">{message} <button type="button" className="underline" onClick={retry}>Retry</button></div>;
}

function OptionPages({ offset, hasMore, onChange, disabled, label }: { offset: number; hasMore: boolean; onChange: (value: number) => void; disabled: boolean; label: string }) {
  if (!offset && !hasMore) return null;
  return <div className="flex justify-between gap-2"><Button type="button" size="sm" variant="ghost" disabled={disabled || !offset} onClick={() => onChange(Math.max(0, offset - 50))} aria-label={`Previous ${label}`}>Previous</Button><Button type="button" size="sm" variant="ghost" disabled={disabled || !hasMore} onClick={() => onChange(offset + 50)} aria-label={`Next ${label}`}>Next</Button></div>;
}
