import countryCodes from "./country-codes.json";

function normalizeCountry(value: string) {
  return value.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const codesByCountry = new Map(Object.entries(countryCodes).flatMap(([name, code]) => [
  [normalizeCountry(name), code], [normalizeCountry(code), code],
]));

for (const [alias, code] of Object.entries({
  usa: "us", unitedstatesofamerica: "us", uk: "gb", greatbritain: "gb",
  uae: "ae", southkorea: "kr", northkorea: "kp", russia: "ru",
  vietnam: "vn", czechrepublic: "cz", ivorycoast: "ci", turkey: "tr",
})) codesByCountry.set(alias, code);

export function countryFlagCode(country: string): string | null {
  const code = codesByCountry.get(normalizeCountry(country));
  return code && code !== "xx" ? code : null;
}
