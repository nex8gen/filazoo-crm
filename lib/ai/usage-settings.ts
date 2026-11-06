import { z } from "zod";

/** Convert exactly to the ledger's microdollars; never round a tiny cap to zero. */
export function aiUsageAmount(value: string): number | null {
  if (value.trim() === "") return null;
  const numeric = Number(value);
  const converted = Math.round(numeric * 1e6);
  return Number.isSafeInteger(converted) && converted / 1e6 === numeric ? converted : NaN;
}

const micros = z.number().int().min(0).max(1_000_000_000_000);
export const aiUsageSettingsSchema = z.object({
  revision: z.number().int().min(0),
  monthlyMicros: micros.min(10_000),
  dailyMicros: micros.nullable(),
  minimumShares: z.number().int().min(1).max(10000),
  members: z.array(z.object({ userId: z.uuid(), enabled: z.boolean(), dailyMicros: micros.nullable() }).strict()).max(1000),
}).strict().refine(value => new Set(value.members.map(member => member.userId)).size === value.members.length, "Choose each member only once.");
export type AiUsageSettingsInput = z.infer<typeof aiUsageSettingsSchema>;
export type AiUsageSettingsView = Omit<AiUsageSettingsInput, "members"> & {
  workspaceDailyMicros: number;
  monthlyUsedMicros: number;
  members: Array<AiUsageSettingsInput["members"][number] & { name: string; role: string; usedMicros: number; effectiveDailyMicros: number }>;
};
