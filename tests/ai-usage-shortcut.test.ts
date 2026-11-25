import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as credits from '../lib/billing/credits.ts';
import * as creditEvents from '../lib/billing/credit-events.ts';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://crm.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node'] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true });
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
const h = React.createElement;
type Props = Record<string, unknown> & { children?: React.ReactNode };
const source = ts.transpileModule(readFileSync(new URL('../components/ai-usage-shortcut.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

async function mount(fetcher: typeof fetch, expanded = true) {
  const deps: Record<string, unknown> = {
    react: React, 'next/link': { default: ({ children, ...props }: Props) => h('a', props, children) },
    '@/lib/billing/credits': credits,
    '@/lib/billing/credit-events': creditEvents,
  };
  const exports: { AiUsageShortcut?: React.ComponentType<{ expanded?: boolean }> } = {};
  vm.runInNewContext(source, { exports, require: (name: string) => deps[name] ?? require(name), fetch: fetcher, AbortController, AbortSignal, Date, window: dom.window, document: dom.window.document });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await React.act(async () => { root.render(h(exports.AiUsageShortcut!, { expanded })); });
  return { host, dispose: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}
const balance = { includedMicros: 15000000, topupMicros: 0, usedMicros: 42790, remainingMicros: 14957210, resetsAt: '2026-12-01T00:00:00+08:00', percent: 1 };

test('sidebar rounds down to whole credits without decimal points, a popup or retry button', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const ui = await mount(async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ credits: balance, enabled: true, plan: 'business' }); });
  try {
    assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/ai/credits'); assert.equal(calls[0].init?.cache, 'no-store');
    assert.equal(ui.host.querySelector('[data-no-translate]')?.textContent, '14,957');
    assert.equal(ui.host.querySelector('section')?.hasAttribute('data-plan'), false);
    assert.equal(ui.host.querySelector('button'), null);
    assert.match(ui.host.textContent!, /credits left/);
    assert.doesNotMatch(ui.host.textContent!, /Credits used|Monthly allowance|Additional credits|Renews/);
    assert.equal(ui.host.querySelector('a')?.getAttribute('href'), '/settings/credits');
    assert.equal(ui.host.querySelector('[role=dialog]'), null);
    assert.ok(Number(ui.host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')) > 99);
    await React.act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    assert.equal(calls.length, 2);
  } finally { await ui.dispose(); }
  await React.act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
  assert.equal(calls.length, 2, 'focus refresh listener is cleaned up');
});

test('sidebar aborts pending requests on unmount and shows a loading placeholder', async () => {
  let signal: AbortSignal | undefined | null;
  const ui = await mount(async (_url, init) => {
    signal = init?.signal;
    return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  assert.equal(ui.host.querySelector('[role=status]')?.getAttribute('aria-label'), 'Loading usage');
  assert.equal(ui.host.querySelector('[role=progressbar]'), null);
  await ui.dispose();
  assert.equal(signal?.aborted, true);
});

test('sidebar recovers from errors and shows an empty balance truthfully', async () => {
  let calls = 0;
  const ui = await mount(async () => {
    if (++calls === 1) return Response.json({ error: 'private data' }, { status: 503 });
    return Response.json({ credits: { ...balance, remainingMicros: 0, usedMicros: balance.includedMicros }, enabled: true });
  });
  try {
    assert.match(ui.host.textContent!, /Unable to load usage/); assert.doesNotMatch(ui.host.textContent!, /private data/);
    assert.doesNotMatch(ui.host.textContent!, /Retry/);
    assert.equal(ui.host.querySelector('button'), null);
    await React.act(async () => dom.window.dispatchEvent(new dom.window.Event('focus')));
    assert.equal(ui.host.querySelector('[data-no-translate]')?.textContent, '0');
    assert.match(ui.host.textContent!, /AI credits are used up/);
    assert.equal(ui.host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'), '0');
    assert.equal(ui.host.querySelector('button'), null);
  } finally { await ui.dispose(); }
});

test('fractional credits stay available and paused accounts are identified', async () => {
  for (const enabled of [true, false]) {
    const ui = await mount(async () => Response.json({ credits: { ...balance, remainingMicros: 790, usedMicros: balance.includedMicros - 790 }, enabled, plan: 'pro' }));
    try {
      assert.equal(ui.host.querySelector('[data-no-translate]')?.textContent, '<1');
      assert.match(ui.host.textContent!, enabled ? /Low balance/ : /AI paused/);
      assert.doesNotMatch(ui.host.textContent!, /used up/);
    } finally { await ui.dispose(); }
  }
});

test('collapsed sidebar provides a direct credits link', async () => {
  const ui = await mount(async () => Response.json({ credits: balance, enabled: true }), false);
  try {
    assert.equal(ui.host.querySelector('a')?.getAttribute('aria-label'), 'AI usage');
    assert.equal(ui.host.querySelector('a')?.getAttribute('href'), '/settings/credits');
    const details = ui.host.querySelector('.workspace-ai-usage-reveal');
    assert.ok(details?.hasAttribute('inert'), 'collapsed details stay mounted for the closing animation without accepting focus');
    assert.equal(details?.getAttribute('aria-hidden'), 'true');
    assert.equal(ui.host.querySelector('.workspace-ai-usage-compact')?.hasAttribute('inert'), false);
    assert.equal(ui.host.querySelector('[role=dialog]'), null);
  } finally { await ui.dispose(); }
});

test('a completed AI task refreshes the whole credit balance immediately and cleans up its listener', async () => {
  let calls = 0;
  const ui = await mount(async () => {
    calls++;
    return Response.json({ credits: { ...balance, remainingMicros: balance.remainingMicros - (calls > 1 ? 275 : 0) }, enabled: true });
  });
  await React.act(async () => creditEvents.notifyAiCreditsChanged());
  assert.equal(calls, 2);
  assert.equal(ui.host.querySelector('[data-no-translate]')?.textContent, '14,956');
  await ui.dispose();
  creditEvents.notifyAiCreditsChanged();
  assert.equal(calls, 2);
});

test('an AI completion during a pending read queues a fresh balance instead of dropping the update', async () => {
  let finish: ((response: Response) => void) | undefined;
  let calls = 0;
  const ui = await mount(async () => {
    if (++calls === 1) return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json({ credits: { ...balance, remainingMicros: balance.remainingMicros - 275 }, enabled: true });
  });
  try {
    await React.act(async () => creditEvents.notifyAiCreditsChanged());
    assert.equal(calls, 1);
    await React.act(async () => { finish!(Response.json({ credits: balance, enabled: true })); });
    assert.equal(calls, 2);
    assert.equal(ui.host.querySelector('[data-no-translate]')?.textContent, '14,956');
  } finally { await ui.dispose(); }
});
