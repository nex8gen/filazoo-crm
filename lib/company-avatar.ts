export const companyPortraits = Array.from({ length: 6 }, (_, index) => `/avatars/companies/portrait-${index + 1}.svg`);

// A stable shuffle keeps a company's portrait identical on every screen and reload.
export function companyPortrait(companyId: string) {
  let hash = 2166136261;
  for (const character of companyId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return companyPortraits[(hash >>> 0) % companyPortraits.length];
}
