import type { Company } from "./types.ts";

export const companyExportColumns = ["Name", "Domain", "Country", "Segment", "Assigned BD Manager", "Fit score", "Contact", "Role", "Email", "Next action"];
export type ExportCompany = Pick<Company, "id" | "name" | "domain" | "country" | "segment" | "ownerName" | "fitScore" | "contact" | "contactRole" | "email" | "nextAction">;

export function companyExportRow(company: ExportCompany) {
  return [company.name, company.domain, company.country, company.segment, company.ownerName, company.fitScore, company.contact, company.contactRole, company.email, company.nextAction];
}

/** Quoting alone does not stop spreadsheet formula execution. */
export function csvCell(value: string | number) {
  const text = String(value);
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
}

export function companyExportCsv(companies: ExportCompany[]) {
  return "\uFEFF" + [companyExportColumns, ...companies.map(companyExportRow)].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
