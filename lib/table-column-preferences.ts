import { z } from "zod";

export const tableIds = ["companies", "meta-leads", "purchase-orders", "purchase-order-drafts"] as const;
export type TableId = typeof tableIds[number];
export type ColumnVisibility = Record<string, boolean>;
export type TableColumnPreferences = Record<TableId, ColumnVisibility>;

export const defaultTableColumns: TableColumnPreferences = {
  companies: { addedAt: false },
  "meta-leads": { sourceIds: false },
  "purchase-orders": { delivery: false },
  "purchase-order-drafts": {},
};

const visibilitySchema = z.record(z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/), z.boolean())
  .refine(value => Object.keys(value).length <= 50);

export const tableColumnInputSchema = z.object({
  tableId: z.enum(tableIds),
  visibility: visibilitySchema,
}).strict();

// Separate metadata keys keep table choices independent of account settings and
// other tables, including saves from another tab or device.
export const tableColumnMetadataKey = (tableId: TableId) => `crm_table_columns_${tableId}`;

export function readTableColumnPreferences(metadata: Record<string, unknown> | null | undefined): TableColumnPreferences {
  return Object.fromEntries(tableIds.map(tableId => {
    const parsed = visibilitySchema.safeParse(metadata?.[tableColumnMetadataKey(tableId)]);
    return [tableId, parsed.success ? parsed.data : defaultTableColumns[tableId]];
  })) as TableColumnPreferences;
}

/** One account's optimistic state. Saves survive page unmounts and run in order. */
export function createTableColumnStore(
  initial: TableColumnPreferences,
  persist: (input: { tableId: TableId; visibility: ColumnVisibility }) => Promise<{ error?: string }>,
  onError: (message: string) => void,
) {
  let values = { ...initial };
  const confirmed = { ...initial };
  const listeners = new Set<() => void>();
  let queue = Promise.resolve();
  const emit = () => listeners.forEach(listener => listener());
  return {
    read: (tableId: TableId) => values[tableId],
    readInitial: (tableId: TableId) => initial[tableId],
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    write(tableId: TableId, update: ColumnVisibility | ((current: ColumnVisibility) => ColumnVisibility)) {
      const visibility = { ...(typeof update === "function" ? update(values[tableId]) : update) };
      values = { ...values, [tableId]: visibility };
      emit();
      queue = queue.then(async () => {
        try {
          const result = await persist({ tableId, visibility });
          if (result.error) throw new Error(result.error);
          confirmed[tableId] = visibility;
        } catch {
          if (values[tableId] === visibility) {
            values = { ...values, [tableId]: confirmed[tableId] };
            emit();
          }
          onError("Unable to save column choices to your account. Please try again.");
        }
      });
      return queue;
    },
  };
}
