import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/locations/route.ts";

const request = (query = "") => new Request(`http://localhost/api/locations${query}`);

test("country choices expose names and ISO codes without the worldwide city dataset", async () => {
  const response = GET(request());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.ok(data.countries.length > 200);
  assert.ok(data.countries.some((country: { code: string; name: string }) => country.code === "DE" && country.name === "Germany"));
  assert.equal(data.cities, undefined);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=86400/);
});

test("city choices belong to the selected country and contain no duplicate names", async () => {
  const german = await GET(request("?country=DE")).json();
  const british = await GET(request("?country=GB")).json();
  assert.ok(german.cities.includes("Berlin"));
  assert.ok(!german.cities.includes("London"));
  assert.ok(british.cities.includes("London"));
  assert.ok(!british.cities.includes("Berlin"));
  assert.equal(new Set(german.cities).size, german.cities.length);
  assert.deepEqual(await GET(request("?country=DE")).json(), german);
});

test("invalid country parameters cannot return the global city list", async () => {
  for (const code of ["", "ZZ", "de", "Germany", "../US"]) {
    const response = GET(request(`?country=${encodeURIComponent(code)}`));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).cities, undefined);
  }
});

test("countries without city records return an empty list for manual city entry", async () => {
  const response = GET(request("?country=AQ"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cities: [] });
});
