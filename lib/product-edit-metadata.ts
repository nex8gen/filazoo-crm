/** Price/variant edits own their encoded tags; other catalog metadata remains intact. */
export function productEditMetadata(existing: { tags?: string[] | null; description?: string | null }, tags: string[], generatedDescription: string) {
  return {
    tags: [...new Set([...(existing.tags ?? []).filter((tag) => !tag.startsWith("price-tier:") && !tag.startsWith("variant-json:")), "manual", ...tags])],
    description: existing.description === null || existing.description === undefined || existing.description.startsWith("Volume pricing:") ? generatedDescription : existing.description,
  };
}
