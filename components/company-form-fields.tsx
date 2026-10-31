"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { companySegmentOptions, contactRoleOptions, normalizeOption, type CountryOption } from "@/lib/company-form-options";

type LocationData = { countries?: CountryOption[]; cities?: string[] };
const locationCache = new Map<string, LocationData>();

function useLocations(url: string | null) {
  const [result, setResult] = useState<{ url: string; data?: LocationData; error?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!url || locationCache.has(url)) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Location lookup failed");
        const data: LocationData = await response.json();
        locationCache.set(url, data);
        if (!controller.signal.aborted) setResult({ url, data });
      })
      .catch(() => { if (!controller.signal.aborted) setResult({ url, error: true }); });
    return () => controller.abort();
  }, [url, attempt]);
  const current = result?.url === url ? result : null;
  const data = url ? locationCache.get(url) ?? current?.data : undefined;
  return { data, error: current?.error, loading: Boolean(url && !data && !current?.error), retry: () => { setResult(null); setAttempt((value) => value + 1); } };
}

function SearchableField({ id, name, label, value, onChange, options, placeholder, required = false, disabled = false, loading = false, custom = false, keywords, hint }: {
  id: string; name: string; label: string; value: string; onChange: (value: string) => void;
  options: readonly string[]; placeholder: string; required?: boolean; disabled?: boolean;
  loading?: boolean; custom?: boolean; keywords?: (option: string) => string; hint?: string;
}) {
  const query = normalizeOption(value);
  const matches = options.filter((option) => normalizeOption(`${option} ${keywords?.(option) ?? ""}`).includes(query));
  const visible = matches.slice(0, 60);
  const isCustom = custom && Boolean(value.trim()) && !options.some((option) => normalizeOption(option) === query);
  const items = isCustom ? [...visible, value] : visible;
  const selected = custom || options.includes(value) ? value || null : null;
  return <div className="min-w-0 space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <Combobox.Root items={items} filter={null} name={name} value={selected} inputValue={value} required={required} disabled={disabled} autoHighlight
      onInputValueChange={(next, details) => { if (details.reason === "input-change" || details.reason === "input-clear") onChange(next); }}
      onValueChange={(next) => { if (next !== null) onChange(next); }}>
      <Combobox.InputGroup className="relative">
        <Combobox.Input id={id} aria-label={label} placeholder={placeholder} aria-describedby={hint ? `${id}-hint` : undefined} autoComplete="off"
          className="h-10 w-full min-w-0 rounded-lg border border-input bg-background py-2 pr-10 pl-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60" />
        <Combobox.Trigger aria-label={`Show ${label.toLowerCase()} options`} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground disabled:opacity-50">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} className="z-[60] outline-none">
          <Combobox.Popup className="w-(--anchor-width) overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
            <Combobox.Empty className="p-3 text-sm text-muted-foreground">{loading ? "Loading options…" : "No matching options"}</Combobox.Empty>
            <Combobox.List className="max-h-[min(var(--available-height),16rem)] overflow-y-auto overscroll-contain p-1">
              {(option: string) => <Combobox.Item key={option} value={option} className="relative flex min-h-9 cursor-default items-center rounded-md py-2 pr-8 pl-3 text-sm outline-none data-highlighted:bg-accent data-selected:font-medium">
                <span>{option}</span>{isCustom && option === value ? <span className="ml-auto pl-2 text-xs text-muted-foreground">Custom</span> : null}
                <Combobox.ItemIndicator className="absolute right-2"><Check className="size-4 text-primary" /></Combobox.ItemIndicator>
              </Combobox.Item>}
            </Combobox.List>
            {matches.length > 60 ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">Type to narrow the list.</p> : null}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
    {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
  </div>;
}

export function CompanyLocationFields({ disabled }: { disabled: boolean }) {
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const countries = useLocations("/api/locations");
  const countryOptions = countries.data?.countries ?? [];
  const selectedCountry = countryOptions.find((option) => option.name === country);
  const cities = useLocations(selectedCountry ? `/api/locations?country=${selectedCountry.code}` : null);
  return <>
    <div className="space-y-2">
      <SearchableField id="company-country" name="country" label="Country" value={country} onChange={(value) => { setCountry(value); if (value !== country) setCity(""); }}
        options={countryOptions.map((option) => option.name)} keywords={(name) => { const code = countryOptions.find((option) => option.name === name)?.code; return `${code ?? ""} ${code === "US" ? "USA America" : code === "GB" ? "UK Britain" : code === "AE" ? "UAE" : ""}`; }}
        placeholder={countries.loading ? "Loading countries…" : "Search or choose a country"} required disabled={disabled || countries.loading || Boolean(countries.error)} loading={countries.loading} />
      {countries.error ? <p role="alert" className="text-xs text-destructive">Unable to load countries. <Button type="button" variant="link" size="sm" onClick={countries.retry}>Retry</Button></p> : null}
    </div>
    <div className="space-y-2">
      <SearchableField key={selectedCountry?.code ?? "none"} id="company-city" name="city" label="City" value={city} onChange={setCity}
        options={cities.data?.cities ?? []} placeholder={!selectedCountry ? "Choose a country first" : "Search or enter a city"} custom
        disabled={disabled || !selectedCountry} loading={cities.loading}
        hint={!selectedCountry ? "City options depend on the selected country." : cities.loading ? "Loading cities. You can also type a city." : "Choose a city or type one that is not listed."} />
      {cities.error ? <p role="alert" className="text-xs text-destructive">Unable to load cities. Enter a city manually or <Button type="button" variant="link" size="sm" onClick={cities.retry}>Retry</Button></p> : null}
    </div>
  </>;
}

export function CompanySegmentField({ disabled, existingSegments = [] }: { disabled: boolean; existingSegments?: string[] }) {
  const [value, setValue] = useState("");
  const options = [...new Set([...companySegmentOptions, ...existingSegments])];
  return <SearchableField id="company-segment" name="segment" label="Segment" value={value} onChange={setValue} options={options}
    placeholder="Choose or enter a segment" required custom disabled={disabled} />;
}

export function ContactRoleField({ disabled }: { disabled: boolean }) {
  const [value, setValue] = useState("");
  return <SearchableField id="contact-role" name="contactRole" label="Role" value={value} onChange={setValue} options={contactRoleOptions}
    placeholder="Choose or enter a role" custom disabled={disabled} />;
}
