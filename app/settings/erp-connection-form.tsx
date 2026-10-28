"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ExternalLink, KeyRound, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { detectErpServerIp, loadErpWarehouses, saveErpConnection, testErpConnection } from "./erp-actions";
import { syncInventory } from "@/app/inventory-actions";
import type { ErpSettingsInput, ErpSettingsView } from "@/lib/erp-settings";
import type { LingxingWarehouse } from "@/lib/lingxing";
import type { InventoryStatus } from "@/lib/data/inventory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SkuOption = { sku: string; name: string };
const intervals = [{ value: 0, label: "Manual only" }, { value: 5, label: "Every 5 minutes" }, { value: 15, label: "Every 15 minutes" }, { value: 60, label: "Every hour" }, { value: 1440, label: "Every day" }];

export function ErpConnectionForm({ initial, status, products }: { initial: ErpSettingsView; status: InventoryStatus; products: SkuOption[] }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [appId, setAppId] = useState(initial.appId);
  const [appSecret, setAppSecret] = useState("");
  const [warehouseIds, setWarehouseIds] = useState(initial.warehouseIds);
  const [mappings, setMappings] = useState(initial.mappings);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [syncInterval, setSyncInterval] = useState(initial.syncInterval);
  const [warehouses, setWarehouses] = useState<LingxingWarehouse[]>([]);
  const [serverIp, setServerIp] = useState("");
  const [pending, startTransition] = useTransition();
  const [operation, setOperation] = useState("");
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const dirty = name !== initial.name || appId !== initial.appId || Boolean(appSecret) || warehouseIds !== initial.warehouseIds || enabled !== initial.enabled || syncInterval !== initial.syncInterval || JSON.stringify(mappings) !== JSON.stringify(initial.mappings);

  function values(): ErpSettingsInput {
    return { name, appId, appSecret, warehouseIds, mappings, enabled, syncInterval, revision: initial.revision, appUrl: window.location.origin };
  }
  function run(label: string, task: () => Promise<void>) {
    setOperation(label); setNotice(null);
    startTransition(async () => { try { await task(); } catch { setNotice({ text: "The request could not be completed. Please try again.", error: true }); } });
  }
  const selectedWarehouses = new Set(warehouseIds.split(",").map(x => x.trim()).filter(Boolean));

  return <div className="max-w-4xl space-y-5">
    <Card className="shadow-none"><CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />ERP API connection</CardTitle><CardDescription>Add or update your Lingxing credentials here. Credentials are encrypted and never displayed after saving.</CardDescription></CardHeader><CardContent>
      <form onSubmit={event => { event.preventDefault(); run("save", async () => {
        const result = await saveErpConnection(values());
        if (!result.ok) { setNotice({ text: result.error, error: true }); return; }
        setAppSecret(""); setNotice({ text: "Connection settings saved. Use Sync now to fetch current stock.", error: false }); router.refresh();
      }); }} className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm"><p className="font-medium">Get your API credentials from Lingxing</p><p className="mt-1 text-muted-foreground">Enable OpenAPI in your Lingxing administrator account and grant warehouse inventory details permission. To load warehouse names, also grant warehouse-list permission. Paste the App ID and App Secret below.</p><a href="https://apidoc.lingxing.com/new/guides/new-instructions/" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-primary underline underline-offset-4">Open Lingxing API setup guide<ExternalLink className="size-3" /></a></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="erp-name">Connection name</Label><Input id="erp-name" value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={pending} /></div><div className="space-y-2"><Label htmlFor="erp-provider">ERP provider</Label><Input id="erp-provider" value="Lingxing ERP" readOnly /></div>
          <div className="space-y-2"><Label htmlFor="erp-app-id">App ID</Label><Input id="erp-app-id" autoComplete="off" spellCheck={false} value={appId} onChange={e => setAppId(e.target.value)} required maxLength={100} disabled={pending} /></div>
          <div className="space-y-2"><Label htmlFor="erp-app-secret">App Secret</Label><Input id="erp-app-secret" type="password" autoComplete="new-password" value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder={initial.hasSecret ? "Saved securely — leave blank to keep" : "Enter your App Secret"} maxLength={512} required={!initial.hasSecret || appId !== initial.appId} disabled={pending} /><p className="text-xs text-muted-foreground">Leave blank to keep the saved secret. Enter a new secret when changing the App ID.</p></div>
        </div>
        <div className="space-y-2"><p className="text-sm font-medium">Server IP allowlist</p><p className="text-sm text-muted-foreground">Add the CRM server&apos;s outbound IP to Lingxing&apos;s allowlist. Hosting providers may use several or changing IPs; confirm stable outbound access with your host.</p><Button type="button" variant="outline" disabled={pending} onClick={() => run("ip", async () => { const result = await detectErpServerIp(); if (result.ok) setServerIp(result.ip); else setNotice({ text: result.error, error: true }); })}>{pending && operation === "ip" ? <RefreshCw className="animate-spin" /> : null}Detect server IP</Button>{serverIp ? <p className="font-mono text-sm" data-no-translate>{serverIp}</p> : null}</div>
        <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="erp-warehouses">Warehouse IDs</Label><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run("warehouses", async () => { const result = await loadErpWarehouses(values()); if (result.ok) { setWarehouses(result.warehouses); setNotice({ text: result.warehouses.length ? "Warehouses loaded. Choose warehouses below, or leave IDs blank to include all." : "No warehouses were returned. Check warehouse permissions in Lingxing.", error: false }); } else setNotice({ text: result.error, error: true }); })}>Load warehouses</Button></div><Input id="erp-warehouses" value={warehouseIds} onChange={e => setWarehouseIds(e.target.value)} placeholder="All warehouses, or IDs such as 1,2" disabled={pending} /><p className="text-xs text-muted-foreground">Blank includes all local and overseas warehouses. Amazon FBA is excluded.</p>
          {warehouses.length ? <div className="grid max-h-60 gap-3 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">{warehouses.map(warehouse => <label key={warehouse.id} className="flex items-center gap-2 text-sm"><Checkbox checked={selectedWarehouses.has(warehouse.id)} disabled={pending} onCheckedChange={checked => { const next = new Set(selectedWarehouses); if (checked) next.add(warehouse.id); else next.delete(warehouse.id); setWarehouseIds([...next].join(",")); }} /><span data-no-translate>{warehouse.name} ({warehouse.id})</span></label>)}</div> : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={enabled} onCheckedChange={checked => setEnabled(checked === true)} disabled={pending} />Enable this connection</label><div className="space-y-2"><Label htmlFor="erp-interval">Automatic stock updates</Label><Select value={String(syncInterval)} onValueChange={value => setSyncInterval(Number(value) as typeof syncInterval)} disabled={pending}><SelectTrigger id="erp-interval"><SelectValue>{intervals.find(item => item.value === syncInterval)?.label}</SelectValue></SelectTrigger><SelectContent>{intervals.map(item => <SelectItem key={item.value} value={String(item.value)}>{item.label}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Automatic updates run from your deployed HTTPS CRM. Localhost supports manual sync.</p></div></div>
        <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Product SKU mapping</p><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setMappings([...mappings, { crmSku: "", erpSku: "" }])}><Plus />Add SKU mapping</Button></div><p className="text-sm text-muted-foreground">Identical SKUs match automatically. Add a mapping for each product or color/size variant whose ERP SKU differs.</p>
          <datalist id="erp-crm-skus">{products.map(product => <option key={product.sku} value={product.sku}>{product.name}</option>)}</datalist>
          {mappings.map((mapping, index) => <div className="flex items-end gap-2" key={index}><div className="min-w-0 flex-1 space-y-1"><Label htmlFor={`erp-crm-sku-${index}`}>CRM SKU</Label><Input id={`erp-crm-sku-${index}`} list="erp-crm-skus" value={mapping.crmSku} onChange={e => setMappings(current => current.map((item, position) => position === index ? { ...item, crmSku: e.target.value } : item))} required maxLength={200} disabled={pending} /></div><div className="min-w-0 flex-1 space-y-1"><Label htmlFor={`erp-sku-${index}`}>ERP SKU</Label><Input id={`erp-sku-${index}`} value={mapping.erpSku} onChange={e => setMappings(current => current.map((item, position) => position === index ? { ...item, erpSku: e.target.value } : item))} required maxLength={200} disabled={pending} /></div><Button type="button" variant="ghost" size="icon" aria-label="Remove SKU mapping" disabled={pending} onClick={() => setMappings(current => current.filter((_, position) => position !== index))}><Trash2 /></Button></div>)}
        </div>
        {notice ? <p role={notice.error ? "alert" : "status"} className={`rounded-md border p-3 text-sm ${notice.error ? "border-destructive/30 text-destructive" : "text-foreground"}`}>{notice.text}</p> : null}
        {initial.schedulerError ? <p role="alert" className="text-sm text-destructive">{initial.schedulerError}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}><Save />{pending && operation === "save" ? "Saving…" : "Save connection"}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => run("test", async () => { const result = await testErpConnection(values()); setNotice(result.ok ? { text: "Connection test passed: credentials, IP access, and inventory permission work. Save any changes before syncing.", error: false } : { text: result.error, error: true }); })}><CheckCircle2 />{pending && operation === "test" ? "Testing…" : "Test connection"}</Button><Button type="button" variant="outline" disabled={pending || dirty || !status.configured || status.running} onClick={() => run("sync", async () => { const result = await syncInventory(); setNotice(result.ok ? { text: result.skipped ? "A sync is running or was just requested. Refresh shortly." : `${result.count} ERP SKUs synced.`, error: false } : { text: result.error, error: true }); router.refresh(); })}><RefreshCw className={pending && operation === "sync" ? "animate-spin" : ""} />Sync now</Button></div>
        {dirty ? <p className="text-xs text-muted-foreground">Save your changes before using Sync now.</p> : null}
        <p className="text-xs text-muted-foreground">Turning off the connection pauses automatic and manual syncing. Existing catalog details are kept.</p>
      </form>
    </CardContent></Card>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 text-sm"><p>{status.lastSyncedAt ? `Last successful sync: ${new Date(status.lastSyncedAt).toLocaleString("en", { timeZone: "Asia/Shanghai" })} (China time).` : "No successful sync yet."}</p><Button variant="outline" nativeButton={false} render={<Link href="/catalogs" />}>View product stock</Button></div>
  </div>;
}
