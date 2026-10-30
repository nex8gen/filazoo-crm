import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getQuotationDetail, QuotationError } from "@/lib/data/quotations";
import { QuotationWorkspace } from "@/components/quotation-workspace";

export const metadata: Metadata = { title: "Quotation" };
export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail;
  try { detail = await getQuotationDetail(id); }
  catch (error) { if (error instanceof QuotationError && [400, 404].includes(error.status)) notFound(); throw error; }
  return <QuotationWorkspace key={id} initialDetail={detail} />;
}
