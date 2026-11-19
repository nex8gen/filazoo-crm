import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createUiLocalizer } from "../lib/ui-localization.ts";
import { translateUiText } from "../lib/i18n.ts";

const flush = () => new Promise(resolve => setImmediate(resolve));

test("cached pages and portal menus return in English after being detached in Chinese", async () => {
  const dom = new JSDOM("<title>Products</title><body><section><button title='Add product'>Add product</button><input placeholder='Search variants'></section></body>");
  const { document } = dom.window;
  const localizer = createUiLocalizer(translateUiText);
  const stopChinese = localizer.observe(document, "zh-CN");
  const cached = document.querySelector("section")!;
  const button = cached.querySelector("button")!;
  assert.equal(button.textContent, "添加产品");
  assert.equal(button.title, "添加产品");
  cached.remove();
  stopChinese();
  const stopEnglish = localizer.observe(document, "en");
  document.body.append(cached);
  await flush();
  assert.equal(button.textContent, "Add product");
  assert.equal(button.title, "Add product");
  assert.equal(cached.querySelector("input")!.placeholder, "Search variants");
  assert.equal(document.title, "Products");
  stopEnglish(); dom.window.close();
});

test("new labels, placeholders and page titles translate while Chinese is active", async () => {
  const dom = new JSDOM("<title>Home</title><body><button title='Inbox'>Inbox</button><input placeholder='Search variants'></body>");
  const { document } = dom.window;
  const localizer = createUiLocalizer(translateUiText);
  const stop = localizer.observe(document, "zh-CN");
  const button = document.querySelector("button")!;
  const text = button.firstChild!;
  text.nodeValue = "Sent";
  button.title = "Sent";
  document.querySelector("input")!.placeholder = "Search company media";
  document.title = "Products";
  const menu = document.createElement("div"); menu.innerHTML = "<button aria-label='More conversation actions'>Rename</button>";
  document.body.append(menu);
  await flush();
  assert.equal(button.firstChild, text, "React's text-node identity must survive translation");
  assert.equal(button.textContent, "已发送");
  assert.equal(button.title, "已发送");
  assert.equal(document.querySelector("input")!.placeholder, "搜索企业媒体");
  assert.equal(document.title, "产品");
  assert.equal(menu.textContent, "重命名");
  assert.equal(menu.firstElementChild!.getAttribute("aria-label"), "更多对话操作");
  stop(); localizer.localize(document.body, "en");
  assert.equal(button.textContent, "Sent");
  assert.equal(button.title, "Sent");
  dom.window.close();
});

test("repeated switches preserve editable content, business data and the latest React label", async () => {
  const dom = new JSDOM("<body><button>Inbox</button><span data-no-translate title='Products'>Products</span><span translate='no'>产品</span><div contenteditable='true'>Products</div><input value='Products'><pre>Products</pre><span>Acme Industrial GmbH</span></body>");
  const { document } = dom.window;
  const localizer = createUiLocalizer(translateUiText);
  const button = document.querySelector("button")!;
  for (let index = 0; index < 3; index++) {
    const stop = localizer.observe(document, "zh-CN");
    assert.equal(button.textContent, index ? "已发送" : "收件箱");
    button.firstChild!.nodeValue = "Sent";
    await flush();
    stop();
    localizer.localize(document.body, "en");
    assert.equal(button.textContent, "Sent");
  }
  assert.equal(document.querySelector("[data-no-translate]")!.textContent, "Products");
  assert.equal(document.querySelector("[data-no-translate]")!.getAttribute("title"), "Products");
  assert.equal(document.querySelector("[translate=no]")!.textContent, "产品");
  assert.equal(document.querySelector("[contenteditable]")!.textContent, "Products");
  assert.equal(document.querySelector("input")!.value, "Products");
  assert.equal(document.querySelector("pre")!.textContent, "Products");
  assert.equal(document.body.lastElementChild!.textContent, "Acme Industrial GmbH");
  dom.window.close();
});

test("removed attribute sources are discarded before React reuses the element", async () => {
  const dom = new JSDOM("<body><button title='Inbox'>Inbox</button></body>");
  const localizer = createUiLocalizer(translateUiText);
  const { document } = dom.window;
  const stop = localizer.observe(document, "zh-CN");
  const button = document.querySelector("button")!;
  button.removeAttribute("title"); await flush();
  button.title = "Sent"; await flush();
  stop(); localizer.localize(button, "en");
  assert.equal(button.title, "Sent");
  dom.window.close();
});

test("rich text editor labels and empty hints translate while their content stays untouched", async () => {
  const dom = new JSDOM("<body><div contenteditable='true' aria-label='Description' data-placeholder='Describe your product…'>Products <b>产品</b></div><div contenteditable='false'>Products</div></body>");
  const localizer = createUiLocalizer(translateUiText);
  const { document } = dom.window;
  const editor = document.querySelector("div")!;
  const stop = localizer.observe(document, "zh-CN");
  assert.equal(editor.getAttribute("aria-label"), translateUiText("Description", "zh-CN"));
  assert.equal(editor.getAttribute("data-placeholder"), "描述您的产品…");
  assert.equal(editor.innerHTML, "Products <b>产品</b>");
  assert.equal(document.body.lastElementChild!.textContent, "Products");
  editor.setAttribute("data-placeholder", "Write your reply…"); await flush();
  assert.equal(editor.getAttribute("data-placeholder"), "撰写回复…");
  stop(); localizer.localize(document.body, "en");
  assert.equal(editor.getAttribute("data-placeholder"), "Write your reply…");
  assert.equal(editor.innerHTML, "Products <b>产品</b>");
  dom.window.close();
});
