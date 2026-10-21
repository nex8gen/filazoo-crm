import assert from "node:assert/strict";
import test from "node:test";
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
