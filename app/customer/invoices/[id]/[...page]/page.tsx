import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CustomerPortal } from "@/components/customer-portal";
export const metadata = { title: "Customer portal", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
async function CustomerPage({ params }: { params: Promise<{ id: string; page: string[] }> }) {
  const { id, page } = await params;
  const path = page.join("/");
  if (!z.uuid().safeParse(id).success || !/^(orders|billing|messages|pages\/[A-Za-z0-9_-]{1,64})$/.test(path)) notFound();
  return <CustomerPortal key={`${id}:${path}`} invoiceId={id} page={path} />;
}
export default function Page(props: { params: Promise<{ id: string; page: string[] }> }) {
  return <Suspense fallback={<p className="p-8" role="status">Opening your customer portal…</p>}><CustomerPage {...props} /></Suspense>;
}
