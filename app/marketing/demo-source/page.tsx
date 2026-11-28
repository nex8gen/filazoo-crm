import { notFound } from "next/navigation";
import { CrmDemoSource } from "@/components/marketing/crm-demo-source";

export const metadata = { robots: { index: false, follow: false }, title: "NewAI CRM demo export" };

export default async function DemoSourcePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  // This source renderer exists solely for exporting static sample-data previews.
  if (process.env.NODE_ENV !== "development") notFound();
  const { view = "home" } = await searchParams;
  if (!["home", "email", "workflow", "orders"].includes(view)) notFound();
  return <CrmDemoSource view={view} />;
}
