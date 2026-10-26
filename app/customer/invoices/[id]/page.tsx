import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CustomerPortal } from "@/components/customer-portal";
export const metadata = { title: "Customer portal", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <CustomerPortal invoiceId={id} />;
}
export default function Page(props: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="p-8" role="status">Opening your customer portal…</p>}><CustomerPage {...props} /></Suspense>;
}
