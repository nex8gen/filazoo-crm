// Read each page with a stable order so older customer history is not silently
// cut off by the Data API's default row limit.
export async function readActivityHistory<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const result = await query(from, from + pageSize - 1);
    if (result.error) throw new Error(`Unable to load customer history: ${result.error.message}`);
    rows.push(...result.data ?? []);
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
}
