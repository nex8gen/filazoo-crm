import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as credits from '../lib/billing/credits.ts';

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
  };
  const exports: { AiUsageShortcut?: React.ComponentType<{ expanded?: boolean }> } = {};
  vm.runInNewContext(source, { exports, require: (name: string) => deps[name] ?? require(name), fetch: fetcher, AbortController, AbortSignal, Date, window: dom.window, document: dom.window.document });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await React.act(async () => { root.render(h(exports.AiUsageShortcut!, { expanded })); });
  return { host, dispose: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}
const balance = { includedMicros: 15000000, topupMicros: 0, usedMicros: 42790, remainingMicros: 14957210, resetsAt: '2026-12-01T00:00:00+08:00', percent: 1 };

test('sidebar loads the whole balance inline without a popup or retry button', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const ui = await mount(async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ credits: balance, enabled: true, plan: 'business' }); });
  try {
    assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/ai/credits'); assert.equal(calls[0].init?.cache, 'no-store');
    assert.equal(ui.host.querySelector('[data-no-translate]')?.textContent, '14,957');
    assert.equal(ui.host.querySelector('section')?.hasAttribute('data-plan'), false);
    assert.equal(ui.host.querySelector('button'), null);
    assert.match(ui.host.textContent!, /credits left/);
    assert.doesNotMatch(ui.host.textContent!, /14,957\.21|Credits used|Monthly allowance|Additional credits|Renews/);
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
    assert.equal(ui.host.querySelector('section'), null);
    assert.equal(ui.host.querySelector('[role=dialog]'), null);
  } finally { await ui.dispose(); }
});
