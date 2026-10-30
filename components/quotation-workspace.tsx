"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { formatMoney } from "@/lib/invoices";
import { buildQuotation, quotationLabel, quotationState, quotationStatusLabels, quotationToday, quotationShareBlockers, type QuotationAction, type QuotationDetail, type QuotationInput } from "@/lib/quotations";

const selectClass = "min-h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60";

export function QuotationWorkspace({ initialDetail }: { initialDetail: QuotationDetail }) {
  const router = useRouter();
  const { language } = useLanguage();
  const c = (en: string, zh: string) => language === "zh-CN" ? zh : en;
  const [detail, setDetail] = useState(initialDetail);
  const [input, setInput] = useState(initialDetail.initial);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [allowCustom, setAllowCustom] = useState(false);
  const { catalog, canWrite } = detail;
  const products = catalog.product_snapshot ?? [];
  const legacy = !catalog.product_snapshot;
  const editable = canWrite && catalog.quote_status === "draft" && !catalog.quote_order_id && !legacy;
  const dirty = JSON.stringify(input) !== JSON.stringify(detail.initial);
  const state = quotationState(catalog);
  const statusZh = { draft: "草稿", shared: "已分享", accepted: "已接受", declined: "已拒绝", cancelled: "已取消", superseded: "已有新版本", expired: "已过期", converted: "已创建订单" };
  const money = (minor: number) => formatMoney(minor, catalog.currency);
  let preview = catalog.quote_document;
  let validation = "";
  if (editable) {
    try { preview = buildQuotation(input, products, catalog.quote_document ?? { sellerName: "Filazoo", sellerAddress: "", customerName: catalog.company, issueDate: quotationToday(), currency: catalog.currency as "USD" }); }
    catch (err) { preview = null; validation = err instanceof Error ? err.message : "Check the quotation details."; }
  }
  const set = <K extends keyof QuotationInput>(key: K, value: QuotationInput[K]) => { setInput(old => ({ ...old, [key]: value })); setSuccess(""); };
  const line = (index: number, patch: Partial<QuotationInput["items"][number]>) => set("items", input.items.map((item, i) => i === index ? { ...item, ...patch } : item));
  async function act(action: QuotationAction["action"]) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(""); setSuccess("");
    const payload = { action, revision: catalog.quote_revision, ...(action === "save" ? { document: input } : {}), ...(action === "accept" ? { note: acceptance } : {}), ...(action === "convert" ? { allowCustomItems: allowCustom } : {}) };
    try {
      const response = await fetch(`/api/catalogs/${catalog.id}/quotation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || c("Unable to save the quotation.", "无法保存报价。"));
      if (body.newId) { router.push(`/catalogs/companies/${body.newId}`); router.refresh(); return; }
      setDetail(body.detail); setInput(body.detail.initial); setAcceptance("");
      setSuccess(c("Quotation updated.", "报价已更新。")); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : c("Connection failed. Reload before retrying.", "连接失败，请刷新后重试。")); }
    finally { busy.current = false; setPending(false); }
  }
  async function reload() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      const response = await fetch(`/api/catalogs/${catalog.id}/quotation`, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setDetail(body); setInput(body.initial); setSuccess("");
    } catch { setError(c("Unable to reload the quotation.", "无法刷新报价。")); }
    finally { busy.current = false; setPending(false); }
  }
  const blockers = quotationShareBlockers(catalog.quote_document);
  const field = (en: string, zh: string, key: "customerEmail" | "billingAddress" | "taxId" | "shippingAddress" | "shippingRecipient" | "shippingPhone" | "paymentTerms" | "notes", multiline = false) => (
    <label className="grid gap-2 text-sm" key={key}><span>{c(en, zh)}</span>{multiline ? <Textarea value={input[key]} disabled={!editable || pending} maxLength={key === "taxId" ? 100 : 2000} onChange={e => set(key, e.target.value)} /> : <Input type={key === "customerEmail" ? "email" : "text"} value={input[key]} disabled={!editable || pending} maxLength={key === "taxId" ? 100 : key === "shippingRecipient" ? 160 : key === "shippingPhone" ? 80 : 254} onChange={e => set(key, e.target.value)} />}</label>
  );
  return <div data-no-translate className="mx-auto max-w-6xl space-y-5 [&_input:disabled]:opacity-100 [&_textarea:disabled]:opacity-100 [&_select:disabled]:opacity-100">
    <Link href="/catalogs/companies" className="text-sm text-muted-foreground hover:underline">← {c("Company quotations", "公司报价")}</Link>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{quotationLabel(catalog)}</h1><Badge variant="secondary">{language === "zh-CN" ? statusZh[state] : quotationStatusLabels[state]}</Badge></div><p className="mt-2 text-muted-foreground">{catalog.company} · {catalog.currency}</p></div>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending || dirty} onClick={reload}>{c("Reload", "刷新")}</Button>{canWrite ? <Button type="button" variant="outline" disabled={pending || dirty} onClick={() => act("revise")}>{legacy ? c("Create current version", "创建当前版本") : c("New version", "新建版本")}</Button> : null}</div>
    </div>
    {catalog.quote_previous_id ? <Link href={`/catalogs/companies/${catalog.quote_previous_id}`} className="block text-sm underline">{c("View previous version", "查看上一版本")}</Link> : null}
    {error ? <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}<Button type="button" variant="ghost" onClick={reload} disabled={pending} className="ml-2">{c("Reload saved version", "刷新已保存版本")}</Button></div> : null}
    {success ? <p role="status" className="text-sm text-green-700">{c("Quotation updated.", "报价已更新。")}</p> : null}
    {legacy ? <Card className="p-5"><h2 className="font-semibold">{c("Older product selection", "旧产品选单")}</h2><p className="text-sm text-muted-foreground">{c("This older Catalog has no saved product snapshot. Create a current version to freeze today's products and prices before preparing a quotation. The older document stays available.", "此旧目录没有保存产品快照。请创建当前版本以固定今天的产品及价格，再准备报价。旧文档仍可查看。")}</p></Card> : <>
      <Card className="gap-4 p-5"><h2 className="font-semibold">{c("Quotation details", "报价详情")}</h2><div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2 text-sm"><span>{c("Valid until (China time)", "有效期至（中国时间）")}</span><DatePicker aria-label={c("Valid until (China time)", "有效期至（中国时间）")} value={input.validUntil} onValueChange={value => set("validUntil", value)} disabled={!editable || pending} required /></div>
        {field("Customer email", "客户邮箱", "customerEmail")}{field("Billing address", "账单地址", "billingAddress", true)}{field("Tax ID", "税号", "taxId")}{field("Shipping address", "收货地址", "shippingAddress", true)}
        <div className="grid gap-4">{field("Shipping recipient", "收货人", "shippingRecipient")}{field("Shipping phone", "联系电话", "shippingPhone")}</div>
      </div></Card>
      <Card className="gap-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{c("Products and agreed prices", "产品及商定价格")}</h2>{editable ? <Button type="button" variant="outline" disabled={pending || input.items.length >= 99 || !products.length} onClick={() => { const p = products[0]; set("items", [...input.items, { productSku: p.sku, quantity: Math.max(1, p.moq ?? 1), pricingMode: "saved", ...(p.variants.length === 1 ? { variantId: p.variants[0].id } : {}) }]); }}>{c("Add line", "添加项目")}</Button> : null}</div>
        <p className="text-sm text-muted-foreground">{c("Saved prices use this version's product snapshot and quantity tiers. An agreed price applies only to this quotation.", "保存价格使用此版本的产品快照及数量阶梯价。商定价格仅适用于此报价。")}</p>
        {input.items.length > 99 ? <p role="alert" className="text-sm text-destructive">{c("Keep up to 99 product lines. Remove a line before saving.", "最多保留99个产品项目，请删除多余项目后保存。")}</p> : null}
        {input.items.map((item, index) => { const p = products.find(product => product.sku === item.productSku); const saved = preview?.items[index]; return <fieldset key={index} disabled={!editable || pending} className="min-w-0 space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-xs text-muted-foreground">{c("Line", "项目")} {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1 text-sm"><span>{c("Product", "产品")}</span><select className={selectClass} value={item.productSku} onChange={e => { const next = products.find(product => product.sku === e.target.value)!; line(index, { productSku: next.sku, variantId: next.variants.length === 1 ? next.variants[0].id : undefined, quantity: Math.max(1, next.moq ?? 1), pricingMode: "saved", unitPriceMinor: undefined }); }}>{products.map(product => <option key={product.sku} value={product.sku}>{product.name} · {product.sku}</option>)}</select></label>
          {p?.variants.length ? <label className="grid gap-1 text-sm"><span>{c("Variant", "规格")}</span><select className={selectClass} value={item.variantId ?? ""} onChange={e => line(index, { variantId: e.target.value || undefined })}><option value="">{c("Choose variant", "选择规格")}</option>{p.variants.map(variant => <option key={variant.id} value={variant.id}>{variant.name} · {variant.sku}</option>)}</select></label> : null}</div>
          <div className="grid items-end gap-3 sm:grid-cols-4"><label className="grid gap-1 text-sm"><span>{c("Quantity", "数量")}</span><Input type="number" min={1} max={1000000} step={1} value={item.quantity} onChange={e => line(index, { quantity: Number(e.target.value) })} /></label><label className="grid gap-1 text-sm"><span>{c("Pricing", "定价")}</span><select className={selectClass} value={item.pricingMode} onChange={e => line(index, { pricingMode: e.target.value as "saved" | "agreed", unitPriceMinor: saved?.unitPriceMinor ?? item.unitPriceMinor ?? 0 })}><option value="saved">{c("Saved price", "保存价格")}</option><option value="agreed">{c("Agreed price", "商定价格")}</option></select></label>
          <label className="grid gap-1 text-sm"><span>{c("Unit price", "单价")} ({catalog.currency})</span>{item.pricingMode === "agreed" ? <Input type="number" min={0} max={1000000} step="0.01" value={(item.unitPriceMinor ?? 0) / 100} onChange={e => line(index, { unitPriceMinor: Math.round(Number(e.target.value) * 100) })} /> : <output className="min-h-10 py-2">{saved ? money(saved.unitPriceMinor) : "—"}</output>}</label>
          <div className="flex items-center justify-between gap-2"><output className="text-sm font-medium">{saved ? money(saved.quantity * saved.unitPriceMinor) : "—"}</output>{editable ? <Button type="button" variant="ghost" size="sm" disabled={input.items.length <= 1} aria-label={`${c("Remove line", "删除项目")} ${index + 1}`} onClick={() => set("items", input.items.filter((_, i) => i !== index))}>{c("Remove", "删除")}</Button> : null}</div></div>
        </fieldset>; })}
      </Card>
      <Card className="gap-4 p-5"><h2 className="font-semibold">{c("Shipping and payment", "运费及付款")}</h2><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-4"><label className="grid gap-2 text-sm"><span>{c("Shipping cost", "运费")} ({catalog.currency})</span><Input disabled={!editable || pending} type="number" min={0} max={1000000} step="0.01" value={input.shippingMinor / 100} onChange={e => { setInput(old => ({ ...old, shippingMinor: Math.round(Number(e.target.value) * 100), shippingConfirmed: false })); }} /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!editable || pending} checked={input.shippingConfirmed} onChange={e => set("shippingConfirmed", e.target.checked)} />{c("Shipping cost is agreed, including free shipping if zero.", "运费已确认，包括运费为零时的包邮约定。")}</label></div><label className="grid gap-2 self-start text-sm"><span>{c("Payment required before shipment (%)", "发货前须支付（%）")}</span><Input disabled={!editable || pending} type="number" min={0} max={100} step={1} value={input.preShipmentPercent} onChange={e => set("preShipmentPercent", Number(e.target.value))} /></label>{field("Agreed payment terms", "商定付款条款", "paymentTerms", true)}{field("Notes", "备注", "notes", true)}</div>
        <div className="ml-auto w-full max-w-sm space-y-2 border-t pt-4 text-sm"><p className="flex justify-between"><span>{c("Products subtotal", "产品小计")}</span><strong>{preview ? money(preview.subtotalMinor) : "—"}</strong></p><p className="flex justify-between"><span>{c("Shipping", "运费")}</span><span>{money(input.shippingMinor)}</span></p><p className="flex justify-between border-t pt-2 text-base"><span>{c("Quotation total", "报价总额")}</span><strong>{preview ? money(preview.totalMinor) : "—"}</strong></p></div>
      </Card>
      {editable ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{dirty ? c("You have unsaved changes. Save before changing status or creating a version.", "存在未保存的更改。请先保存，再更改状态或创建新版本。") : c("Save the draft before recording that it was shared.", "请先保存草稿，再记录已分享。")}</p>{validation ? <p className="text-sm text-destructive" role="alert">{validation.startsWith("[") ? c("Check the dates, quantities and prices before saving.", "保存前请检查日期、数量及价格。") : validation}</p> : null}<Button type="button" disabled={pending || !preview} onClick={() => act("save")}>{pending ? c("Saving…", "保存中…") : c("Save quotation", "保存报价")}</Button></div> : null}
    </>}
    <Card className="gap-4 p-5"><h2 className="font-semibold">{c("Documents and next action", "文档及后续操作")}</h2>
      <div className="flex flex-wrap gap-3">{catalog.quote_document ? <><a className="text-sm underline" href={`/api/catalogs/${catalog.id}/quotation/pdf`} target="_blank" rel="noreferrer">{c("Preview saved quotation PDF", "预览已保存报价PDF")}</a><a className="text-sm underline" href={`/api/catalogs/${catalog.id}/quotation/pdf?download=1`}>{c("Download quotation PDF", "下载报价PDF")}</a></> : null}<a className="text-sm text-muted-foreground underline" href={`/api/catalogs/${catalog.id}/pdf`} target="_blank" rel="noreferrer">{c("Original product selection PDF", "原产品选单PDF")}</a></div>
      {canWrite && !legacy && !catalog.quote_order_id ? <>
        {catalog.quote_status === "draft" ? <><p className="text-sm text-muted-foreground">{c("Record sharing after you share the PDF with the customer. This action does not send a message.", "向客户分享PDF后，在此记录分享状态。此操作不会发送消息。")}</p>{blockers.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{blockers.map(blocker => <li key={blocker}>{c(blocker, blocker === "Save the quotation details first." ? "请先保存报价详情。" : blocker.startsWith("Confirm") ? "请确认运费，包括约定包邮。" : blocker.startsWith("Enter") ? "请填写商定付款条款。" : "请设置尚未过期的有效期。")}</li>)}</ul> : null}<Button type="button" className="self-start" disabled={pending || dirty || blockers.length > 0} onClick={() => act("share")}>{c("Record as shared", "记录已分享")}</Button></> : null}
        {state === "shared" ? <><label className="grid gap-2 text-sm"><span>{c("Customer acceptance evidence", "客户接受凭据")}</span><Textarea value={acceptance} maxLength={2000} disabled={pending} onChange={e => setAcceptance(e.target.value)} placeholder={c("Example: customer confirmed this version by WeChat on 30 October.", "例如：客户于10月30日通过微信确认此版本。")} /></label><p className="text-sm text-muted-foreground">{c("This records the customer's confirmation received outside the CRM.", "此操作记录在CRM外收到的客户确认。")}</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={pending || dirty || !acceptance.trim()} onClick={() => act("accept")}>{c("Record customer acceptance", "记录客户接受")}</Button><Button type="button" variant="outline" disabled={pending || dirty} onClick={() => act("decline")}>{c("Record declined", "记录已拒绝")}</Button></div></> : null}
        {state === "expired" ? <p className="text-sm text-muted-foreground">{c("This offer has expired. Create a new version before recording acceptance.", "此报价已过期。请创建新版本后再记录客户接受。")}</p> : null}
        {state === "accepted" ? <><p className="text-sm text-muted-foreground">{c("Create one draft purchase order with the accepted quantities, prices, shipping and payment terms. Review and confirm it in the order workspace.", "根据已接受的数量、价格、运费及付款条款创建一份采购订单草稿，并在订单页面审核确认。")}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={allowCustom} disabled={pending} onChange={e => setAllowCustom(e.target.checked)} />{c("Allow custom order items if a saved product or variant is no longer available. Keep the accepted SKU and price.", "若保存的产品或规格已不可用，允许作为自定义订单项目，并保留已接受的SKU及价格。")}</label><Button type="button" className="self-start" disabled={pending || dirty} onClick={() => act("convert")}>{c("Create draft order", "创建订单草稿")}</Button></> : null}
        {["draft", "shared"].includes(catalog.quote_status) ? <Button type="button" variant="ghost" className="self-start text-destructive" disabled={pending || dirty} onClick={() => act("cancel")}>{c("Cancel quotation", "取消报价")}</Button> : null}
      </> : null}
      {catalog.quote_order_id ? <Link href={`/companies/${catalog.company_id}?tab=purchase-orders&orderId=${catalog.quote_order_id}`} className="text-sm font-medium underline">{c("Open linked order", "打开关联订单")}</Link> : null}
      {!canWrite ? <p className="text-sm text-muted-foreground">{c("You have read-only access to this quotation.", "您对此报价仅有查看权限。")}</p> : null}
    </Card>
  </div>;
}
