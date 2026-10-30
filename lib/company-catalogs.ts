import type { Catalog } from "./types.ts";
import { quotationLabel } from "./quotations.ts";

export function filterCompanyCatalogs(catalogs: Catalog[], query: string, currency: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return catalogs.filter((catalog) => {
    const matchesQuery =
      !normalizedQuery ||
      [catalog.company, catalog.currency, String(catalog.version), quotationLabel(catalog), ...catalog.productSkus]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    const matchesCurrency = currency === "all" || catalog.currency === currency;

    return matchesQuery && matchesCurrency;
  });
}
