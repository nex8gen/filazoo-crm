"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, MapPin, Package2, Search, SlidersHorizontal, Sparkles, Target } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leadApi } from "@/lib/lead-client";
import { leadSearchSchema, type LeadProduct, type LeadSearch, type LeadSearchInput } from "@/lib/ai-leads";
import { buyerRoleLabels, type BuyerProfile } from "@/lib/lead-prospecting";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; products: LeadProduct[]; countries: string[]; seed?: LeadSearchInput; onCreated: (search: LeadSearch) => void };
const stepNames = ["Products", "Buyer profile", "Review"];

export function AiLeadsSearchDialog({ open, onOpenChange, products, countries, seed, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"catalog" | "custom">("catalog");
  const [skus, setSkus] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [context, setContext] = useState("");
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [category, setCategory] = useState("");
  const [definition, setDefinition] = useState("");
  const [segments, setSegments] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [requirements, setRequirements] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [limit, setLimit] = useState<3 | 5 | 10>(3);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"profile" | "search" | null>(null);
  const [error, setError] = useState("");
  const initialized = useRef(false);
  const lastRequest = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    if (!open) { initialized.current = false; return; }
    if (initialized.current) return;
    initialized.current = true;
    setStep(0); setProfile(null); setError(""); setQuery("");
    setSkus(seed?.productSkus ?? []);
    setMode(seed?.customProduct ? "custom" : "catalog");
    setCustomName(seed?.customProduct?.name ?? ""); setCustomDescription(seed?.customProduct?.description ?? "");
    setContext(seed?.productContext ?? "");
    const previousCountry = seed?.country ?? "";
    const aliases: Record<string, string> = { usa: "United States", us: "United States", uk: "United Kingdom" };
    setCountry(countries.find(item => item.toLowerCase() === previousCountry.toLowerCase()) || aliases[previousCountry.toLowerCase()] || previousCountry);
    setCity(seed?.city ?? ""); setRequirements(seed?.requirements ?? ""); setExclusions(seed?.exclusions ?? "");
    setLimit(seed?.limit ?? 3); setName(""); lastRequest.current = null;
  }, [open, seed, countries]);

  function changeProducts(update: () => void) { update(); setProfile(null); lastRequest.current = null; }
  const productSelection = {
    productSkus: mode === "catalog" ? skus : [],
    ...(mode === "custom" ? { customProduct: { name: customName, description: customDescription } } : {}),
    productContext: context,
  };
  async function prepare() {
    setError("");
    if (profile) { setStep(1); return; }
    if (mode === "catalog" && !skus.length) { setError("Select at least one product."); return; }
    if (mode === "custom" && (customName.trim().length < 2 || customDescription.trim().length < 10)) { setError("Add a product name and a useful description of its applications."); return; }
    setBusy("profile");
    try {
      const data = await leadApi<{ profile: BuyerProfile }>("/api/ai/leads/profile", "POST", productSelection);
      setProfile(data.profile); setCategory(data.profile.category); setDefinition(data.profile.definition);
      const preferred = data.profile.segments.filter(segment => ["end_user", "service_provider", "manufacturer"].includes(segment.role));
      setSegments((preferred.length ? preferred : data.profile.segments).slice(0, 3).map(segment => segment.id));
      setStep(1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Buyer targeting could not be prepared."); }
    finally { setBusy(null); }
  }
  function review() {
    setError("");
    if (!category.trim() || definition.trim().length < 10) { setError("Confirm the product category and how it is used."); return; }
    if (!segments.length) { setError("Select at least one buyer group."); return; }
    if (!country) { setError("Choose a target country."); return; }
    if (profile?.clarity === "needs_clarification" && category === profile.category && definition === profile.definition) { setError("Clarify the product category and description before searching."); return; }
    if (!name) setName([category, city || country].join(" · "));
    setStep(2);
  }
  async function start() {
    if (!profile) return;
    setError("");
    const values = { ...productSelection, profileId: profile.id, segmentIds: segments, categoryOverride: category, definitionOverride: definition, country, city, requirements, exclusions, limit, searchName: name, buyerTypes: "" };
    const key = JSON.stringify(values);
    if (lastRequest.current?.key !== key) lastRequest.current = { key, id: crypto.randomUUID() };
    const parsed = leadSearchSchema.safeParse({ ...values, requestId: lastRequest.current.id });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Check the search settings."); return; }
    setBusy("search");
    try {
      const data = await leadApi<{ search: LeadSearch }>("/api/ai/leads", "POST", parsed.data);
      onCreated(data.search); onOpenChange(false); lastRequest.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The search could not be started."); }
    finally { setBusy(null); }
  }
  const picked = profile?.segments.filter(segment => segments.includes(segment.id)) ?? [];
  const visibleProducts = products.filter(product => (product.name + " " + product.sku).toLowerCase().includes(query.toLowerCase()));

  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="lead-search-dialog" showCloseButton={!busy}>
      <div className="ld-dialog-heading">
        <span className="ld-dialog-symbol"><Target size={20} /></span>
        <div><DialogTitle>Build a customer search</DialogTitle><DialogDescription>Start with your product. Confirm who is likely to buy it.</DialogDescription></div>
      </div>
      <ol className="ld-stepper" aria-label="Search setup progress">{stepNames.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={13} /> : index + 1}</span>{label}</li>)}</ol>
      <div className="ld-dialog-body">
        {error ? <div role="alert" className="ld-alert">{error}</div> : null}
        {step === 0 ? <div className="ld-step-content">
          <div className="ld-step-intro"><h3>What are you selling?</h3><p>Your catalog belongs to this workspace. Product codes will be resolved into a clear product category.</p></div>
          <div className="ld-mode-switch" aria-label="Product source"><button type="button" className={mode === "catalog" ? "is-active" : ""} onClick={() => changeProducts(() => setMode("catalog"))}>Workspace products</button><button type="button" className={mode === "custom" ? "is-active" : ""} onClick={() => changeProducts(() => setMode("custom"))}>Describe a product</button></div>
          {mode === "catalog" ? <>
            <div className="ld-product-search"><Search size={16} /><Input aria-label="Find products" placeholder="Find a product by name or SKU" value={query} onChange={event => setQuery(event.target.value)} /></div>
            <div className="ld-product-list" aria-label="Workspace product selection">
              {!visibleProducts.length ? <p className="ld-no-products">No matching products. Try another name or describe a product.</p> : visibleProducts.map(product => <label className={"ld-product-option " + (skus.includes(product.sku) ? "is-selected" : "")} key={product.sku}>
                <Checkbox aria-label={product.name} checked={skus.includes(product.sku)} disabled={!skus.includes(product.sku) && skus.length >= 5} onCheckedChange={checked => changeProducts(() => setSkus(previous => checked ? [...previous, product.sku] : previous.filter(sku => sku !== product.sku)))} />
                <span className="ld-product-icon"><Package2 size={18} /></span>
                <span className="ld-product-name" data-no-translate><strong>{product.name}</strong><small>{product.sku}</small></span>
                {skus.includes(product.sku) ? <Check size={16} className="ld-selected-check" /> : null}
              </label>)}
            </div>
            <p className="ld-helper">{skus.length} selected <span>· Choose up to 5 related products</span></p>
          </> : <div className="ld-fields"><div><Label htmlFor="new-lead-product">Product name</Label><Input id="new-lead-product" value={customName} maxLength={160} onChange={event => changeProducts(() => setCustomName(event.target.value))} placeholder="What do you sell?" /></div><div><Label htmlFor="new-lead-description">Description and applications</Label><Textarea id="new-lead-description" rows={4} value={customDescription} maxLength={1500} onChange={event => changeProducts(() => setCustomDescription(event.target.value))} placeholder="Explain what it does, its specifications, and how customers use it." /></div></div>}
          <details className="ld-advanced"><summary><SlidersHorizontal size={14} />Add product context<ChevronDown size={14} /></summary><div className="ld-fields"><Label htmlFor="new-lead-context">Clarify product names or applications</Label><Textarea id="new-lead-context" value={context} maxLength={1000} onChange={event => changeProducts(() => setContext(event.target.value))} placeholder="Helpful for abbreviations, specialized materials or a new product line." /></div></details>
        </div> : null}
        {step === 1 && profile ? <div className="ld-step-content">
          <div className="ld-step-intro"><h3>Confirm your ideal customers</h3><p>Review the product interpretation and choose the buyer groups you want to reach.</p></div>
          {profile.clarity === "needs_clarification" ? <div className="ld-callout" role="status">{profile.clarification || "This product needs a clearer definition. Edit the category and description below."}</div> : null}
          <div className="ld-category-editor"><span className="ld-field-kicker">Product interpretation</span><Label htmlFor="buyer-category">Product category</Label><Input id="buyer-category" value={category} maxLength={160} onChange={event => setCategory(event.target.value)} /><Label htmlFor="buyer-definition">What this product is used for</Label><Textarea id="buyer-definition" rows={2} value={definition} maxLength={1000} onChange={event => setDefinition(event.target.value)} /><small>AI suggestion — confirm or edit before searching.</small></div>
          <div><div className="ld-section-label"><h4>Target buyer groups</h4><span>{segments.length} selected</span></div><div className="ld-buyer-grid">{profile.segments.map(segment => <label key={segment.id} className={"ld-buyer-option " + (segments.includes(segment.id) ? "is-selected" : "")}>
            <Checkbox aria-label={segment.label} checked={segments.includes(segment.id)} onCheckedChange={checked => setSegments(previous => checked ? [...previous, segment.id] : previous.filter(id => id !== segment.id))} />
            <span><strong data-no-translate>{segment.label}</strong><small>{buyerRoleLabels[segment.role]}</small><p data-no-translate>{segment.reason}</p></span>
          </label>)}</div></div>
          <div className="ld-location-fields"><div><Label htmlFor="buyer-country">Target country</Label><Select value={country || null} onValueChange={value => setCountry(value ?? "")}><SelectTrigger id="buyer-country" className="w-full"><SelectValue placeholder="Choose a country" /></SelectTrigger><SelectContent>{countries.map(value => <SelectItem key={value} value={value} data-no-translate>{value}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="buyer-city">City or region <span className="ld-optional">optional</span></Label><Input id="buyer-city" value={city} maxLength={100} onChange={event => setCity(event.target.value)} placeholder="All locations in this country" /></div></div>
          <details className="ld-advanced"><summary><SlidersHorizontal size={14} />Qualification rules<ChevronDown size={14} /></summary><div className="ld-fields"><div><Label htmlFor="buyer-requirements">Must-have requirements</Label><Textarea id="buyer-requirements" value={requirements} maxLength={1500} onChange={event => setRequirements(event.target.value)} placeholder="Only include requirements that must be supported by evidence." /></div><div><Label htmlFor="buyer-exclusions">Exclude business types or companies</Label><Input id="buyer-exclusions" value={exclusions} maxLength={1000} onChange={event => setExclusions(event.target.value)} placeholder={profile.excludeHints.slice(0, 2).join(", ")} /></div></div></details>
        </div> : null}
        {step === 2 && profile ? <div className="ld-step-content">
          <div className="ld-step-intro"><h3>Ready to find companies</h3><p>We will discover businesses, check the evidence, and collect their public contact details.</p></div>
          <div className="ld-fields"><Label htmlFor="lead-search-name">Search name</Label><Input id="lead-search-name" value={name} maxLength={160} onChange={event => setName(event.target.value)} /></div>
          <div className="ld-review-box"><div><Package2 size={17} /><span><small>Product category</small><strong data-no-translate>{category}</strong></span></div><div><Target size={17} /><span><small>Buyer groups</small><strong data-no-translate>{picked.map(segment => segment.label).join(", ")}</strong></span></div><div><MapPin size={17} /><span><small>Target market</small><strong data-no-translate>{[city, country].filter(Boolean).join(", ")}</strong></span></div></div>
          <div><Label htmlFor="lead-research-limit">Research size</Label><div className="ld-size-options" id="lead-research-limit">{([3, 5, 10] as const).map(value => <button type="button" key={value} aria-pressed={limit === value} className={limit === value ? "is-active" : ""} onClick={() => setLimit(value)}><strong>{value}</strong><span>companies</span>{value === 3 ? <small>Small test</small> : null}</button>)}</div></div>
          <div className="ld-review-notes"><p><Check size={14} />Company identity, product relevance and location checked separately</p><p><Check size={14} />Public email, phone and contact pages when available</p><p><Check size={14} />Review results before adding anything to CRM</p></div>
          <p className="ld-cost-note">Uses existing AI credits. Up to $0.20 for a new buyer profile and one search. No paid contact databases or automatic outreach.</p>
        </div> : null}
      </div>
      <div className="ld-dialog-footer"><Button variant="ghost" onClick={() => step ? setStep(previous => previous - 1) : onOpenChange(false)} disabled={Boolean(busy)}>{step ? <><ArrowLeft size={15} />Back</> : "Cancel"}</Button><span className="ld-footer-step">Step {step + 1} of 3</span><Button onClick={step === 0 ? prepare : step === 1 ? review : start} disabled={Boolean(busy)}>{busy ? <Loader2 size={16} className="animate-spin" /> : step === 2 ? <Search size={16} /> : <Sparkles size={16} />}{busy === "profile" ? "Preparing buyer profile…" : busy === "search" ? "Starting research…" : step === 0 ? "Build buyer profile" : step === 1 ? "Review search" : "Find companies"}{!busy && step < 2 ? <ArrowRight size={15} /> : null}</Button></div>
    </DialogContent>
  </Dialog>;
}
