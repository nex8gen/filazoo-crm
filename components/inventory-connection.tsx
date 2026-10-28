"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RefreshCw, Warehouse } from "lucide-react";
import { syncInventory } from "@/app/inventory-actions";
import type { InventoryStatus } from "@/lib/data/inventory";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function InventoryConnection({ status, canSync, canManage = false, matched, total }: { status: InventoryStatus; canSync: boolean; canManage?: boolean; matched: number; total: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const stale = status.stale;
  function sync() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await syncInventory();
        setFailed(!result.ok);
        setMessage(result.ok ? result.skipped ? "A sync is running or was just requested. Refresh shortly." : `${result.count} ERP SKUs synced.` : result.error);
        router.refresh();
      } catch { setFailed(true); setMessage("Unable to sync stock. Please try again."); }
    });
  }
  return <Card className="gap-0 py-0 shadow-none"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0 space-y-1 text-sm">
      <p className="flex items-center gap-2 font-medium"><Warehouse className="size-4" />Lingxing ERP stock <span className="text-xs font-normal text-muted-foreground">{status.configured ? status.lastSyncedAt ? stale ? "Needs refresh" : "Synced" : "Ready to sync" : "Not connected"}</span></p>
      {status.configured ? <>
        <p className="text-muted-foreground">Available stock from {status.warehouseIds ? `warehouses ${status.warehouseIds}` : "all local and overseas warehouses"}. {matched} of {total} products fully matched.</p>
        <p className="text-xs text-muted-foreground">{status.lastSyncedAt ? `Last sync: ${new Date(status.lastSyncedAt).toLocaleString("en", { timeZone: "Asia/Shanghai" })} (China time).` : "No successful sync yet."} {stale ? "Stock is over 30 minutes old." : ""} Unmatched products have unknown stock. Amazon FBA is excluded.</p>
        {matched < total ? <p className="text-xs text-muted-foreground">Match each product or variant SKU to its ERP SKU. An administrator can configure aliases when SKUs differ.</p> : null}
      </> : <p className="max-w-3xl text-muted-foreground">Add or enable your Lingxing connection in Settings to sync product stock.</p>}
      {status.configurationError || status.lastError ? <p role="alert" className="text-destructive">{status.configurationError || status.lastError}</p> : null}
      {message ? <p role="status" className={failed ? "text-destructive" : "text-muted-foreground"}>{message}</p> : null}
    </div>
    <div className="flex shrink-0 flex-wrap gap-2">{canManage ? <Button variant="outline" nativeButton={false} render={<Link href="/settings/erp" />}>Manage ERP connection</Button> : null}{canSync ? <Button variant="outline" disabled={pending || status.running || !status.configured} onClick={sync}><RefreshCw className={pending ? "animate-spin" : ""} />{pending || status.running ? "Syncing…" : "Sync stock"}</Button> : null}</div>
  </CardContent></Card>;
}
