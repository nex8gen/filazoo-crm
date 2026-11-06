"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PurchaseOrdersError({ retry }: { error: unknown; retry: () => void }) {
  return <div role="alert" className="space-y-3 rounded-xl border p-6"><h2 className="font-semibold">Purchase orders could not be loaded</h2><p className="text-sm text-muted-foreground">Check your connection and try again.</p><div className="flex items-center gap-4"><Button variant="outline" onClick={retry}>Try again</Button><Link href="/purchase-orders" className="text-sm text-primary underline">All purchase orders</Link></div></div>;
}
