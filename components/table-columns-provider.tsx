"use client";

import { createContext, startTransition, useCallback, useContext, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { toast } from "sonner";
import { saveTableColumns } from "@/app/table-column-actions";
import { createTableColumnStore, type ColumnVisibility, type TableColumnPreferences, type TableId } from "@/lib/table-column-preferences";

const TableColumnsContext = createContext<ReturnType<typeof createTableColumnStore> | null>(null);

export function TableColumnsProvider({ initial, children }: { initial: TableColumnPreferences; children: ReactNode }) {
  const [store] = useState(() => createTableColumnStore(initial, input => new Promise((resolve, reject) => {
    startTransition(async () => {
      try { resolve(await saveTableColumns(input)); }
      catch (error) { reject(error); }
    });
  }), message => toast.error(message)));
  return <TableColumnsContext.Provider value={store}>{children}</TableColumnsContext.Provider>;
}

export function useTableColumns(tableId: TableId): [ColumnVisibility, Dispatch<SetStateAction<ColumnVisibility>>] {
  const store = useContext(TableColumnsContext);
  if (!store) throw new Error("TableColumnsProvider is missing");
  const getSnapshot = useCallback(() => store.read(tableId), [store, tableId]);
  const getServerSnapshot = useCallback(() => store.readInitial(tableId), [store, tableId]);
  const visibility = useSyncExternalStore(store.subscribe, getSnapshot, getServerSnapshot);
  const setVisibility = useCallback<Dispatch<SetStateAction<ColumnVisibility>>>(update => {
    void store.write(tableId, update);
  }, [store, tableId]);
  return [visibility, setVisibility];
}
