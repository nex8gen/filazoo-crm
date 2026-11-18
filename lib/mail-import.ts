export const mailImportLimits = [50, 100, 500, 1000, 2500, 5000] as const;
export type MailImportPreferences = {
  historyLimit: number;
  historyFolders: "inbox_sent" | "all";
  historyPaused: boolean;
};
export const newMailImportPreferences: MailImportPreferences = { historyLimit: 500, historyFolders: "inbox_sent", historyPaused: false };
export const legacyMailImportPreferences: MailImportPreferences = { historyLimit: 5000, historyFolders: "all", historyPaused: false };

export function parseMailImportPreferences(value: unknown): MailImportPreferences {
  const input = value as Partial<MailImportPreferences> | null;
  if (!input || !Number.isInteger(input.historyLimit) || !mailImportLimits.includes(input.historyLimit as typeof mailImportLimits[number]) ||
    !["inbox_sent", "all"].includes(input.historyFolders || "") || typeof input.historyPaused !== "boolean") {
    throw new Error("Choose an import limit from 50 to 5,000 and a valid folder selection.");
  }
  return { historyLimit: input.historyLimit!, historyFolders: input.historyFolders!, historyPaused: input.historyPaused };
}

export function readMailImportPreferences(value: unknown): MailImportPreferences {
  try { return parseMailImportPreferences(value); } catch { return { ...legacyMailImportPreferences }; }
}

/** Missing fields on an older settings form must preserve an existing policy. */
export function connectionImportPreferences(form: FormData, editing: boolean): MailImportPreferences | undefined {
  const value = form.get("syncPreferences");
  if (value === null) return editing ? undefined : { ...newMailImportPreferences };
  try { return parseMailImportPreferences(JSON.parse(String(value))); }
  catch { throw new Error("Choose valid email import settings before connecting."); }
}

export function historyFolderSelected(preferences: MailImportPreferences, kind: string) {
  return preferences.historyFolders === "all" ? !["spam", "trash"].includes(kind) : ["inbox", "sent"].includes(kind);
}

export function importTimeEstimate(remaining: number, received: number, elapsedMs: number): string | null {
  if (remaining <= 0 || received < 25 || elapsedMs < 1000) return null;
  const seconds = remaining * elapsedMs / received / 1000;
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return "About a minute remaining";
  const low = Math.max(1, Math.floor(seconds * 0.75 / 60));
  const high = Math.max(low + 1, Math.ceil(seconds * 1.5 / 60));
  return `About ${low}–${high} minutes remaining`;
}
