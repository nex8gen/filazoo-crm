import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as catalog from "../lib/billing/plans.ts";
import * as features from "../lib/billing/features.ts";
import * as paymentIcons from "../lib/payment-icons.ts";
const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/subscribe?new=1" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "FormData"])
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const sharedComponents = new Map();
function requireComponent(name) {
    if (!name.startsWith("@/components/"))
        return require(name);
    if (sharedComponents.has(name))
        return sharedComponents.get(name);
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL("../" + name.slice(2) + ".tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports, require: requireComponent });
    sharedComponents.set(name, exports);
    return exports;
}
const source = ts.transpileModule(readFileSync(new URL("../app/subscribe/plan-form.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
async function mount(props = { enabled: true }, discountResult = { discountPercent: 100 }) {
    const submissions = [];
    const exports = {};
    const dependencies = { "@/lib/billing/plans": catalog, "@/lib/billing/features": features, "@/lib/payment-icons": paymentIcons, "./discount-actions": { applySubscriptionDiscount: async () => discountResult }, "./actions": { startCheckout: async (_state, form) => { submissions.push(Object.fromEntries(form)); return { error: "Checkout test response" }; } } };
    vm.runInNewContext(source, { exports, require: (name) => dependencies[name] ?? requireComponent(name) });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await React.act(async () => { root.render(React.createElement(exports.PlanForm, props)); });
    const click = async (selector) => { await React.act(async () => { host.querySelector(selector).click(); }); };
    const inputSeats = async (value) => {
        await React.act(async () => {
            const input = host.querySelector('[name="seats"]');
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
            input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
    };
    return { host, click, inputSeats, submissions, dispose: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}
async function enterDiscount(host, value) {
    await React.act(async () => {
        const input = host.querySelector('[name="discountCode"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
}
skipPreviewTest("a validated subscription discount enables free activation without Alipay and edits restore the original total", async () => {
    const ui = await mount({ enabled: false });
    try {
        await enterDiscount(ui.host, "fixture-free");
        await ui.click('.subscription-discount button');
        assert.match(ui.host.querySelector('.subscription-discount-success').textContent, /100% off/);
        assert.match(ui.host.querySelector('.subscription-checkout-total').textContent, /¥0/);
        const button = ui.host.querySelector('[type="submit"]');
        assert.equal(button.disabled, false);
        assert.equal(button.textContent, "Activate plan for free");
        assert.equal(ui.host.querySelector('.subscription-payment-notice'), null);
        await ui.click('[name="plan"][value="business"]');
        await ui.click('[name="billingPeriod"][value="annual"]');
        assert.match(ui.host.querySelector('.subscription-checkout-total').textContent, /¥0/);
        assert.equal(ui.host.querySelector('[name="name"]'), null);
        await React.act(async () => ui.host.querySelector('form').requestSubmit());
        assert.equal(ui.submissions[0].discountCode, 'fixture-free');
        assert.equal(ui.submissions[0].plan, 'business');
        await enterDiscount(ui.host, 'changed-code');
        assert.equal(button.disabled, true);
        assert.equal(ui.host.querySelector('.subscription-discount-success'), null);
        assert.doesNotMatch(ui.host.querySelector('.subscription-checkout-total').textContent, /¥0/);
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("rejected codes keep the actual price and prevent accidental paid checkout", async () => {
    const ui = await mount({ enabled: true }, { error: 'This code is not available.' });
    try {
        await enterDiscount(ui.host, 'fixture-invalid');
        await ui.click('.subscription-discount button');
        assert.match(ui.host.querySelector('#subscription-discount-status').textContent, /not available/);
        assert.equal(ui.host.querySelector('[type="submit"]').disabled, true);
        assert.match(ui.host.querySelector('.subscription-checkout-total').textContent, /139/);
        await enterDiscount(ui.host, '');
        assert.equal(ui.host.querySelector('[type="submit"]').disabled, false);
        assert.equal(ui.submissions.length, 0);
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("packages include fixed users, shared credits and one checkout price without a seat selector", async () => {
    const ui = await mount();
    try {
        assert.equal(ui.host.querySelector('[name="seats"]'), null);
        assert.equal(ui.host.querySelector('[aria-label="Add a seat"]'), null);
        assert.match(ui.host.querySelector('.subscription-checkout-total').textContent, /139/);
        await ui.click('[name="plan"][value="pro"]');
        assert.match(ui.host.querySelector('.subscription-checkout-selection').textContent, /Pro.*2 users.*6,000 AI credits/);
        assert.match(ui.host.querySelector('.subscription-checkout-total').textContent, /429/);
        await ui.click('[name="plan"][value="business"]');
        assert.match(ui.host.querySelector('.subscription-checkout-selection').textContent, /Business.*5 users.*15,000 AI credits/);
        assert.match(ui.host.querySelector('.subscription-checkout-total').textContent, /929/);
        const form = ui.host.querySelector('form');
        assert.equal(ui.host.querySelector('#workspace-name'), null);
        await React.act(async () => form.requestSubmit());
        assert.equal(ui.submissions.length, 1);
        assert.equal(ui.submissions[0].plan, 'business');
        assert.equal(ui.submissions[0].seats, undefined);
        assert.equal(ui.submissions[0].amount, undefined);
        assert.match(ui.host.querySelector('[role="alert"]').textContent, /Checkout test response/);
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("package renewal locks the current plan and preserves the workspace identifier", async () => {
    const ui = await mount({ enabled: true, activePlan: 'pro', workspaceId: 'existing-workspace' });
    try {
        assert.equal(ui.host.querySelector('[name="plan"][value="business"]').disabled, true);
        assert.match(ui.host.querySelector('.subscription-checkout-selection').textContent, /2 users.*6,000/);
        const data = new dom.window.FormData(ui.host.querySelector('form'));
        assert.equal(data.get('workspaceId'), 'existing-workspace');
        assert.equal(data.get('plan'), 'pro');
        assert.equal(data.get('seats'), null);
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("comparison shows shared package limits and shares selection and billing with the cards and checkout", async () => {
    const ui = await mount();
    try {
        const table = ui.host.querySelector('.subscription-comparison-table');
        const metrics = [
            ['AI credits / month', 'credits'], ['Customer companies', 'companies'], ['Products', 'products'],
            ['Connected mailboxes', 'mailboxes'], ['Saved workflows', 'flows'], ['Workflow starts / month', 'flowRuns'],
        ];
        for (const [label, key] of metrics) {
            const row = [...table.querySelectorAll('tbody tr')].find(row => row.querySelector('[scope="row"]')?.textContent === label);
            assert.deepEqual([...row.querySelectorAll('td')].map(cell => cell.textContent), catalog.plans.map(plan => plan[key].toLocaleString('en-US')));
        }
        for (const plan of catalog.plans) {
            const monthlyPrice = `¥${(catalog.planPrice(plan, 'monthly').monthlyFen / 100).toLocaleString('en-US')}`;
            assert.equal(ui.host.querySelector(`.subscription-plan-card[data-plan="${plan.id}"] .subscription-yuan-price`).textContent, monthlyPrice);
            assert.equal(table.querySelector(`thead [data-plan="${plan.id}"] .subscription-comparison-price`).textContent, `${monthlyPrice} / workspace / month`);
            assert.equal(ui.host.querySelector(`[name="plan"][value="${plan.id}"]`).getAttribute('aria-label'), `${plan.name} plan, CNY ${monthlyPrice.slice(1)} per workspace per month`);
            assert.match(table.querySelector(`[data-feature="variants"] td[data-plan="${plan.id}"]`).textContent, /Included/);
            assert.match(table.querySelector(`[data-feature="social"] td[data-plan="${plan.id}"]`).textContent, /Limited access/);
        }
        await ui.click('[aria-label="Select Business from comparison"]');
        assert.equal(ui.host.querySelector('[name="plan"]:checked')?.value, 'business');
        assert.match(ui.host.querySelector('.subscription-checkout-selection').textContent, /Business/);
        assert.equal(ui.submissions.length, 0, 'Comparing a plan must not submit checkout');
        await ui.click('#comparison-annual');
        assert.equal(ui.host.querySelector('[name="billingPeriod"]:checked')?.value, 'annual');
        for (const plan of catalog.plans) {
            const monthlyPrice = `¥${(catalog.planPrice(plan, 'annual').monthlyFen / 100).toLocaleString('en-US')}`;
            assert.equal(ui.host.querySelector(`.subscription-plan-card[data-plan="${plan.id}"] .subscription-yuan-price`).textContent, monthlyPrice);
            assert.equal(table.querySelector(`thead [data-plan="${plan.id}"] .subscription-comparison-price`).textContent, `${monthlyPrice} / workspace / month`);
            assert.equal(ui.host.querySelector(`[name="plan"][value="${plan.id}"]`).getAttribute('aria-label'), `${plan.name} plan, CNY ${monthlyPrice.slice(1)} per workspace per month, billed annually`);
        }
        assert.match(table.querySelector('thead [data-plan="business"]').textContent, /9,348.*year/);
        assert.match(ui.host.querySelector('.subscription-checkout-total').textContent, /9,348/);
        await ui.click('[name="billingPeriod"][value="monthly"]');
        assert.equal(ui.host.querySelector('#comparison-annual').checked, false);
        assert.match(table.querySelector('thead [data-plan="business"]').textContent, /929.*month/);
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("unavailable payment stays disabled and every plan includes the catalog's actual limits", async () => {
    const ui = await mount({ enabled: false });
    try {
        assert.equal(ui.host.querySelector('[type="submit"]').disabled, true);
        assert.match(ui.host.querySelector('[role="status"]').textContent, /payments are being activated/);
        for (const plan of catalog.plans) {
            const card = ui.host.querySelector(`.subscription-plan-card[data-plan="${plan.id}"]`);
            assert.match(card.textContent, new RegExp(plan.credits.toLocaleString("en-US")));
            assert.match(card.textContent, new RegExp(plan.companies.toLocaleString("en-US")));
            assert.match(card.textContent, new RegExp(`${plan.documentBytes / 1e9} GB`));
            assert.equal(card.querySelectorAll("li").length, 6);
        }
    }
    finally {
        await ui.dispose();
    }
});
skipPreviewTest("feature details expand without changing checkout and disclose beta, credit and connection requirements", async () => {
    const ui = await mount();
    try {
        const panel = (id) => ui.host.querySelector(`#feature-details-${id}`);
        assert.equal(panel("products").hidden, false);
        assert.equal(panel("automation").hidden, true);
        await ui.click("#feature-heading-automation");
        assert.equal(panel("automation").hidden, false);
        assert.equal(ui.host.querySelector("#feature-heading-automation").getAttribute("aria-expanded"), "true");
        assert.match(ui.host.querySelector('[data-feature="discovery"]').textContent, /Beta.*Uses AI credits/);
        assert.match(ui.host.querySelector('[data-feature="erp"]').textContent, /Account required/);
        assert.match(ui.host.querySelector('[data-feature="lead-integrations"]').textContent, /Existing enabled workspaces only.*Limited access/);
        await ui.click(".subscription-feature-expand-all");
        assert.equal(ui.host.querySelectorAll('tbody[id^="feature-details-"][hidden]').length, 0);
        assert.match(ui.host.querySelector(".subscription-feature-expand-all").textContent, /Collapse feature details/);
        await ui.click(".subscription-feature-expand-all");
        assert.equal(ui.host.querySelectorAll('tbody[id^="feature-details-"][hidden]').length, 6);
        assert.equal(ui.submissions.length, 0);
        assert.equal(ui.host.querySelector('[name="plan"]:checked').value, "starter");
        assert.equal(ui.host.querySelector('[name="billingPeriod"]:checked').value, "monthly");
        assert.match(ui.host.querySelector(".subscription-checkout-total").textContent, /139/);
    }
    finally {
        await ui.dispose();
    }
});

function skipPreviewTest() {}
const ui = await mount({ enabled: false });
await ui.click('[name="plan"][value="business"]');
const { renderToStaticMarkup } = await import('react-dom/server');
const { compile } = await import('@tailwindcss/node');
const { AccountSetupProgress } = requireComponent('@/components/account-setup-progress');
const progress = renderToStaticMarkup(React.createElement(AccountSetupProgress, { current: 2, className: 'subscription-progress' }));
const body = '<main class="subscription-page"><div class="subscription-container"><section class="subscription-hero"><p class="subscription-eyebrow">Your plan</p><h1>A plan for your business</h1><p class="subscription-intro">Your customers, conversations, and team. One connected workspace, with room to grow.</p>' + progress + '</section>' + ui.host.innerHTML + '</div></main>';
const classes = [...new Set([...new JSDOM(body).window.document.querySelectorAll('[class]')].flatMap(element => element.getAttribute('class').split(/\s+/)))];
const compiler = await compile(readFileSync('app/globals.css', 'utf8'), { base: process.cwd() + '/app', onDependency() {} });
const css = compiler.build(classes) + readFileSync('app/ai-theme.css','utf8') + readFileSync('components/ai-icon.css','utf8') + readFileSync('app/subscribe/subscribe.css','utf8') + ':root { --font-sans: Arial, sans-serif; }';
const html = (content, theme = '') => '<!doctype html><html class="' + theme + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plan brand preview</title><style>' + css + '</style></head><body>' + content + '</body></html>';
const { writeFileSync } = await import('node:fs');
writeFileSync('.cache/plan-brand-preview.html', html(body));
writeFileSync('.cache/plan-brand-preview-dark.html', html(body, 'dark'));
const mobile = html(body).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
writeFileSync('.cache/plan-brand-preview-mobile.html', '<!doctype html><title>Mobile plan preview</title><style>body{margin:0;background:#ddd;display:flex;justify-content:center}iframe{width:390px;height:950px;border:0;background:white}</style><iframe srcdoc="' + mobile + '"></iframe>');
await ui.dispose();
console.log('Rendered plan previews with actual form markup and styles.');
