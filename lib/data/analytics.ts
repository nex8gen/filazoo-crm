import "server-only";

import { analyticsChannelForSource, type AnalyticsDashboardData, type AnalyticsOpportunity } from "../analytics-dashboard.ts";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

type Relation<T> = T | T[] | null;
type CompanyRow = {
  id: string;
  created_at: string;
  source: string | null;
  pipeline: Relation<{
    stage: AnalyticsOpportunity["stage"];
    estimated_value: number | string | null;
    estimated_order_quantity: number | null;
    currency: string;
  }>;
};
type CatalogRow = {
  id: string;
  created_at: string;
  product_skus: string[] | null;
  companies: Relation<{
    source: string | null;
    pipeline: Relation<{ currency: string }>;
  }>;
};

function first<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function getAnalyticsDashboardData(): Promise<AnalyticsDashboardData> {
  await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const client = createSupabaseAdmin();
  const [companiesResult, metaResult, shopifyResult, catalogsResult, productsResult] = await Promise.all([
    client.from("companies")
      .select("id,created_at,source,pipeline(stage,estimated_value,estimated_order_quantity,currency)")
      .or("source.is.null,source.neq.sample_seed")
      .order("created_at", { ascending: true })
      .limit(5000),
    client.from("meta_leads").select("leadgen_id,created_at").order("created_at", { ascending: true }).limit(5000),
    client.from("shopify_leads").select("webhook_id,created_at").order("created_at", { ascending: true }).limit(5000),
    client.from("catalogs").select("id,created_at,product_skus,companies!inner(source,pipeline(currency))").order("created_at", { ascending: true }).limit(5000),
    client.from("products").select("sku,name").not("sku", "like", "SAMPLE-%").limit(5000),
  ]);

  const error = companiesResult.error || metaResult.error || shopifyResult.error || catalogsResult.error || productsResult.error;
  if (error) throw new Error(`Unable to load analytics: ${error.message}`);

  const opportunities = ((companiesResult.data ?? []) as unknown as CompanyRow[]).map((row) => {
    const pipeline = first(row.pipeline);
    return {
      id: row.id,
      createdAt: row.created_at,
      channel: analyticsChannelForSource(row.source),
      stage: pipeline?.stage ?? "new",
      estimatedValue: pipeline?.estimated_value == null ? 0 : Number(pipeline.estimated_value),
      estimatedOrderQuantity: pipeline?.estimated_order_quantity ?? 0,
      currency: pipeline?.currency?.trim() || "USD",
    };
  });

  const leads = [
    ...(metaResult.data ?? []).map((row) => ({ id: `meta-${row.leadgen_id}`, createdAt: row.created_at, channel: "meta" as const })),
    ...(shopifyResult.data ?? []).map((row) => ({ id: `shopify-${row.webhook_id}`, createdAt: row.created_at, channel: "store" as const })),
  ];
  const catalogs = ((catalogsResult.data ?? []) as unknown as CatalogRow[]).map((row) => {
    const company = first(row.companies);
    const pipeline = first(company?.pipeline ?? null);
    return { id: row.id, createdAt: row.created_at, productSkus: row.product_skus ?? [], channel: analyticsChannelForSource(company?.source), currency: pipeline?.currency?.trim() || "USD" };
  });
  const products = Object.fromEntries((productsResult.data ?? []).map((row) => [row.sku, row.name]));
  const currencies = [...new Set(opportunities.map((row) => row.currency))].sort();
  if (currencies.length === 0) currencies.push("USD");

  const dates = [...opportunities.map((row) => row.createdAt), ...leads.map((row) => row.createdAt), ...catalogs.map((row) => row.createdAt)]
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  const today = new Date();
  const earliest = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : today;

  return {
    opportunities,
    leads,
    catalogs,
    products,
    currencies,
    minDate: isoDate(earliest),
    maxDate: isoDate(today),
  };
}
