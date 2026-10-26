import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { translateUiText } from "../lib/i18n.ts";

test("translates core CRM terminology into professional Simplified Chinese", () => {
  assert.equal(translateUiText("Pipeline", "zh-CN"), "销售管道");
  assert.equal(translateUiText("Deliverability", "zh-CN"), "送达能力");
  assert.equal(translateUiText("Company Catalogs", "zh-CN"), "企业专属目录");
  assert.equal(translateUiText("SMTP password / app password", "zh-CN"), "SMTP 密码 / 应用专用密码");
});

test("preserves whitespace and translates dynamic CRM counts", () => {
  assert.equal(translateUiText("  3 actions · 2 active  ", "zh-CN"), "  3 项操作 · 2 个运行中  ");
  assert.equal(translateUiText("Page 2 of 8", "zh-CN"), "第 2 页，共 8 页");
  assert.equal(translateUiText("12 companies", "zh-CN"), "12 家企业");
});

test("keeps English and unknown business data unchanged", () => {
  assert.equal(translateUiText("Pipeline", "en"), "Pipeline");
  assert.equal(translateUiText("Acme Industrial GmbH", "zh-CN"), "Acme Industrial GmbH");
});

test("localizes billing, orders, email, settings, errors and dynamic accessibility labels", () => {
  const cases = {
    "Invoices": "发票",
    "Purchase orders": "客户采购订单",
    "Payment policy": "付款约定",
    "AI reply": "AI 回复",
    "Team and access": "团队与权限",
    "Unable to save this change.": "无法保存此更改。",
    "Page 3 · 42 invoices": "第 3 页 · 42 张发票",
    "Step 2 of 3": "步骤 2，共 3 步",
    "Open account menu for Casey": "打开 Casey 的账户菜单",
    "Quick reply to buyer@example.com": "快速回复 buyer@example.com",
    "3 products exported.": "已导出 3 个产品。",
    "  Save   changes  ": "  保存更改  ",
    "Sign in · Filazoo": "登录 · Filazoo",
    "October 26, 2026": "2026年10月26日",
    "Oct 26, 2026, 9:30 AM": "2026年10月26日 上午9:30",
  };
  for (const [english, chinese] of Object.entries(cases)) {
    assert.equal(translateUiText(english, "zh-CN"), chinese, english);
    assert.equal(translateUiText(english, "en"), english, english);
  }
  assert.equal(translateUiText("constructor", "zh-CN"), "constructor");
  assert.equal(translateUiText("buyer@example.com", "zh-CN"), "buyer@example.com");
  assert.equal(translateUiText("PLA-BASIC-BLACK", "zh-CN"), "PLA-BASIC-BLACK");
});

test("invoice documents stay English while surrounding CRM controls can be Chinese", () => {
  const paper = readFileSync("components/invoice-paper.tsx", "utf8");
  assert.match(paper, /<article[^>]*className="invoice-paper"[^>]*lang="en"[^>]*translate="no"[^>]*data-no-translate/);
  assert.match(paper, /Intl\.DateTimeFormat\("en-US"/);
  assert.match(paper, /<h3>Bill from<\/h3>/);
  assert.match(paper, /<h3>Bill to<\/h3>/);
  const pdf = readFileSync("lib/invoice-pdf.tsx", "utf8");
  assert.ok(pdf.includes("Bill from") && pdf.includes("Bill to"));
  assert.equal(translateUiText("Invoice details", "zh-CN"), "发票详情");
});
