import { z } from "zod";

export const userPreferencesSchema = z.object({
  tablePageSize: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]).default(25),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  reduceMotion: z.boolean().default(false),
  emailTranslate: z.boolean().default(true),
  emailMarkRead: z.boolean().default(true),
  emailSyncSeconds: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60), z.literal(120)]).default(15),
  emailAiSuggestions: z.boolean().default(true),
  emailSignature: z.string().trim().max(2000).default(""),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export const defaultUserPreferences = userPreferencesSchema.parse({});

// Older or independently corrupted fields must not discard other saved choices.
export function readUserPreferences(value: unknown): UserPreferences {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(userPreferencesSchema.shape).map(([key, schema]) => {
    const parsed = schema.safeParse(source[key]);
    return [key, parsed.success ? parsed.data : defaultUserPreferences[key as keyof UserPreferences]];
  })) as UserPreferences;
}

export function withEmailSignature(text: string, signature: string) {
  const body = text.trim();
  const footer = signature.trim();
  return footer && !body.endsWith(footer) ? `${body}\n\n${footer}` : body;
}
