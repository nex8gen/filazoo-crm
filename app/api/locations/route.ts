import { City, Country } from "country-state-city";

const countries = Country.getAllCountries()
  .map(({ isoCode, name }) => ({ code: isoCode, name }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));
const cityCache = new Map<string, string[]>();
const headers = { "Cache-Control": "public, max-age=86400, s-maxage=604800" };

// Public reference data only. Keep the worldwide city dataset on the server.
export function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("country");
  if (code === null) return Response.json({ countries }, { headers });
  if (!countries.some((country) => country.code === code)) {
    return Response.json({ error: "Choose a valid country." }, { status: 400 });
  }
  let cities = cityCache.get(code);
  if (!cities) {
    cities = [...new Set((City.getCitiesOfCountry(code) ?? []).map((city) => city.name))]
      .sort((a, b) => a.localeCompare(b, "en"));
    cityCache.set(code, cities);
  }
  return Response.json({ cities }, { headers });
}
