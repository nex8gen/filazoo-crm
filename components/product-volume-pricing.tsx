"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PriceTier = { minimumQuantity: string; price: string };

export function ProductVolumePricing({ tiers, onChange, currency, onCurrencyChange, canWrite, disabled }: {
  tiers: PriceTier[];
  onChange: (tiers: PriceTier[]) => void;
  currency: string;
  onCurrencyChange: (currency: string) => void;
  canWrite: boolean;
  disabled: boolean;
}) {
  const symbol = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0).find(part => part.type === "currency")?.value ?? currency;

  function update(index: number, changes: Partial<PriceTier>) {
    onChange(tiers.map((tier, position) => position === index ? { ...tier, ...changes } : tier));
  }

  return <Card role="region" aria-labelledby="volume-pricing-heading" className="product-editor-card product-volume-pricing">
    <div className="product-volume-heading">
      <h3 id="volume-pricing-heading">Volume pricing</h3>
      <div className="product-volume-actions">
        <Select name="currency" value={currency} onValueChange={value => { if (value) onCurrencyChange(value); }} disabled={disabled}>
          <SelectTrigger size="sm" aria-label="Pricing currency"><SelectValue /></SelectTrigger>
          <SelectContent>{["USD", "EUR", "GBP", "CNY"].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
        {canWrite && tiers.length < 3 ? <Button type="button" variant="ghost" size="sm" aria-label="Add quantity range" disabled={disabled} onClick={() => onChange([...tiers, { minimumQuantity: String((Number(tiers[tiers.length - 1].minimumQuantity) || 1) + 100), price: "" }])}><Plus />Add range</Button> : null}
      </div>
    </div>

    <Table className="product-volume-table">
      <TableCaption className="sr-only">Quantity ranges and unit prices in {currency}</TableCaption>
      <colgroup><col className="product-volume-quantity-column" /><col /><col className="product-volume-action-column" /></colgroup>
      <TableHeader><TableRow><TableHead>Quantity range</TableHead><TableHead>Unit price <span className="product-volume-currency">{currency}</span></TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
      <TableBody>{tiers.map((tier, index) => <TableRow key={index}>
        <TableCell>
          <div className="product-volume-range">
            <Input id={`minimum-${index + 1}`} name={`minimum${index + 1}`} aria-label={`Range ${index + 1} minimum quantity`} type="number" min={index > 0 ? Number(tiers[index - 1].minimumQuantity) + 1 : 1} step="1" value={tier.minimumQuantity} onChange={event => update(index, { minimumQuantity: event.target.value })} required disabled={disabled} />
            <span aria-hidden="true" className="product-volume-range-separator">–</span>
            {tiers[index + 1] ? <Input id={`maximum-${index + 1}`} aria-label={`Range ${index + 1} maximum quantity`} type="number" min={Number(tier.minimumQuantity) || 1} step="1" value={tiers[index + 1].minimumQuantity === "" ? "" : Number(tiers[index + 1].minimumQuantity) - 1} onChange={event => update(index + 1, { minimumQuantity: event.target.value === "" ? "" : String(Number(event.target.value) + 1) })} required disabled={disabled} /> : <span className="product-volume-unlimited">No limit</span>}
          </div>
        </TableCell>
        <TableCell>
          <InputGroup className="product-volume-price"><InputGroupAddon aria-hidden="true">{symbol}</InputGroupAddon><InputGroupInput id={`price-${index + 1}`} name={`price${index + 1}`} aria-label={`Range ${index + 1} unit price in ${currency}`} type="number" min="0" step="0.01" placeholder="0.00" value={tier.price} onChange={event => update(index, { price: event.target.value })} required disabled={disabled} /></InputGroup>
        </TableCell>
        <TableCell>{canWrite && index === tiers.length - 1 && index > 0 ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove quantity range" title="Remove range" disabled={disabled} onClick={() => onChange(tiers.slice(0, -1))}><Trash2 /></Button> : null}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </Card>;
}
