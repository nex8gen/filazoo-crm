import { CompanyAnalysisDashboard } from "@/components/company-analysis-dashboard";
import { getCompanyAnalysis } from "@/lib/data/company-analysis";
import type { CompanyAnalysisData } from "@/lib/company-analysis";

export async function CompanyAnalysis({ companyId, canWrite, preferredCurrency }: { companyId: string; canWrite: boolean; preferredCurrency: string }) {
  let initial: CompanyAnalysisData | null = null;
  try { initial = await getCompanyAnalysis(companyId); } catch { /* Display a retryable error without presenting missing records as zeros. */ }
  return <CompanyAnalysisDashboard companyId={companyId} canWrite={canWrite} preferredCurrency={preferredCurrency} initial={initial} />;
}
