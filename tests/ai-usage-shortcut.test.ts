import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as credits from '../lib/billing/credits.ts';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://crm.test/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node'] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true });
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
const h = React.createElement;
type Props = Record<string, unknown> & { children?: React.ReactNode };
const PopoverContext = React.createContext<{ open: boolean; change: (next: boolean) => void }>({ open: false, change: () => {} });
const source = ts.transpileModule(readFileSync(new URL('../components/ai-usage-shortcut.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

async function mount(fetcher: typeof fetch) {
  const deps: Record<string, unknown> = {
    react: React, 'next/link': { default: ({ children, ...props }: Props) => h('a', props, children) },
    '@/lib/billing/credits': credits,
    '@/components/ui/popover': {
      Popover: ({ open, onOpenChange, children }: Props) => h(PopoverContext.Provider, { value: { open: Boolean(open), change: onOpenChange as (open: boolean) => void } }, children),
      PopoverTrigger: ({ children, ...props }: Props) => { const ctx = React.useContext(PopoverContext); return h('button', { ...props, 'aria-expanded': ctx.open, onClick: () => ctx.change(!ctx.open) }, children); },
      PopoverContent: ({ children }: Props) => React.useContext(PopoverContext).open ? h('section', { role: 'dialog' }, children) : null,
      PopoverTitle: ({ children }: Props) => h('h2', {}, children),
    },
  };
  const exports: { AiUsageShortcut?: React.ComponentType<{ expanded?: boolean }> } = {};
  vm.runInNewContext(source, { exports, require: (name: string) => deps[name] ?? require(name), fetch: fetcher, AbortController, AbortSignal, Date });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await React.act(async () => { root.render(h(exports.AiUsageShortcut!)); });
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label)!;
  const click = async (label: string) => { await React.act(async () => button(label).click()); };
  return { host, click, dispose: async () => { await React.act(async () => root.unmount()); host.remove(); } };
}
const balance = { includedMicros: 72000000, topupMicros: 0, usedMicros: 1000, remainingMicros: 71999000, resetsAt: '2026-12-01T00:00:00+08:00', percent: 1 };

test('shortcut stays idle until opened, refreshes on demand and links to plan credits', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const ui = await mount(async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ credits: balance, enabled: true }); });
  try {
    assert.equal(calls.length, 0);
    await ui.click('AI usage');
    assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/ai/credits'); assert.equal(calls[0].init?.cache, 'no-store');
    assert.match(ui.host.textContent!, /71,999/); assert.match(ui.host.textContent!, /1 Dec/);
    assert.equal(ui.host.querySelector('a')?.getAttribute('href'), '/settings/credits');
    await ui.click('Refresh usage'); assert.equal(calls.length, 2);
    await ui.click('AI usage');
    assert.equal(ui.host.querySelector('[role=dialog]'), null);
    await ui.click('AI usage'); assert.equal(calls.length, 3);
  } finally { await ui.dispose(); }
});

test('shortcut aborts closed requests and recovers from loading errors', async () => {
  let signal: AbortSignal | undefined | null, calls = 0;
  const ui = await mount(async (_url, init) => {
    calls++; signal = init?.signal;
    if (calls === 1) return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    if (calls === 2) return Response.json({ error: 'private data' }, { status: 503 });
    return Response.json({ credits: { ...balance, remainingMicros: 0, usedMicros: 72000000 }, enabled: true });
  });
  try {
    await ui.click('AI usage'); assert.match(ui.host.textContent!, /Loading usage/);
    await ui.click('AI usage'); assert.equal(signal?.aborted, true);
    await ui.click('AI usage'); assert.match(ui.host.textContent!, /Unable to load AI usage/); assert.doesNotMatch(ui.host.textContent!, /private data/);
    await ui.click('Retry loading usage');
    assert.match(ui.host.textContent!, /AI credits are used up/);
    assert.equal(ui.host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'), '0');
  } finally { await ui.dispose(); }
});
