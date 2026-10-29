import "server-only";
import { Buffer } from "node:buffer";
import { listCompanies } from "../data/crm";
import { getSavedSegment } from "../data/segments";
import { matchesSegment, toSegmentCompany } from "../segments";
import { companyExportCsv, companyExportRow, type ExportCompany } from "../company-export";
import { exportSelectionSchema, type ExportSelection } from "./crm-productivity";

export async function companyExportSnapshot(selection: ExportSelection) {
  const input = exportSelectionSchema.parse(selection);
  const { mode, companies } = await listCompanies({ maxCompanies: 5000, ...(input.scope === "selected" ? { ids: input.companyIds } : {}) });
  if (mode !== "live") throw new Error("Connect the CRM database before exporting companies.");
  const segment = input.scope === "segment" ? await getSavedSegment(input.segmentId) : null;
  if (input.scope === "segment" && !segment) throw new Error("The selected audience is no longer available.");
  const selectedIds = input.scope === "selected" ? new Set(input.companyIds) : null;
  const query = input.scope === "search" ? input.query.toLowerCase() : "";
  const records: ExportCompany[] = companies.filter((company) => selectedIds ? selectedIds.has(company.id)
    : segment ? matchesSegment(toSegmentCompany(company), segment.rules)
      : !query || [company.name, company.domain, company.email, company.contact].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (selectedIds && records.length !== selectedIds.size) throw new Error("Some selected companies are unavailable. Refresh the selection.");
  if (!records.length) throw new Error("No companies match this export selection.");
  if (records.length > 5000) throw new Error("Choose up to 5,000 companies using an audience or a narrower search.");
  if (Buffer.byteLength(companyExportCsv(records), "utf8") > 4_000_000) throw new Error("This CSV is too large to download. Select fewer companies.");
  // Hash only exported fields, not avatars or unrelated private metadata.
  const value = { selection: input, rules: segment?.rules ?? null, rows: records.map((company) => [company.id, ...companyExportRow(company)]) };
  return { records, value, preview: { scope: input.scope, count: records.length, ...(segment ? { audience: segment.name } : {}), sample: records.slice(0, 5).map(({ name }) => name), format: "CSV", destination: "Download to your browser; no email is sent." } };
}
