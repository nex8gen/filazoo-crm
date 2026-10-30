// Date-only strings must be read in local time, never parsed as UTC instants.
export function parsePickerDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

export function pickerDateValue(date: Date): string {
  return [String(date.getFullYear()).padStart(4, "0"), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function pickerSelection(date: Date, previous: string, includeTime: boolean): string {
  return pickerDateValue(date) + (includeTime ? "T" + (previous.split("T")[1] || "09:00") : "");
}

export function validPickerValue(value: string, includeTime: boolean, min?: string, max?: string): boolean {
  if (!value) return true; // The form's required constraint handles empty values.
  if (!parsePickerDate(value)) return false;
  if (includeTime ? !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(value) : !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return (!min || value >= min) && (!max || value <= max);
}
