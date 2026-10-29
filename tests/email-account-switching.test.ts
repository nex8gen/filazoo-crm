import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import type { EmailInboxBackendData } from "../lib/email-inbox.ts";

const require = createRequire(import.meta.url);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function snapshot(id: string): EmailInboxBackendData {
  return {
    selectedMailboxId: id, defaultSenderId: "mine", defaultMailboxEmail: "me@example.test",
    mode: "live", mailboxConfigured: true, sendConfigured: true, inboxConfigured: true,
    inboxError: null, aiConfigured: false, assignedCustomersOnly: id !== "mine",
    mailboxes: ["mine", "team", "other"].map((id) => ({ id, email: `${id}@example.test`, type: id === "mine" ? "personal" : "workspace", sendConfigured: true, inboxConfigured: true })),
    emails: [], automation: { enabled: false, steps: [], queueCount: 0 },
  };
}

// Exercise the component's async event handlers with deterministic hooks and
// controlled HTTP responses, including responses arriving after cancellation.
function mount(signalStatics: unknown = AbortSignal) {
  const time = { now: 0 };
  const timers = new Map<number, { at: number; callback: () => void }>();
  let timerId = 0;
  class Clock extends Date { static now() { return time.now; } }
  const slots: unknown[] = [];
  let cursor = 0;
  const cleanups: Array<() => void> = [];
  const requests: Array<{ url: string; signal: AbortSignal; resolve: (response: Response) => void }> = [];
  const history: string[] = [];
  const listeners = new Map<string, () => void>();
  const location = { pathname: "/emails", search: "" };
  const window = {
    location,
    history: {
      pushState: (_state: unknown, _unused: string, url: string) => { history.push(url); location.search = new URL(url, "http://localhost").search; },
      replaceState: (_state: unknown, _unused: string, url: string) => { location.search = new URL(url, "http://localhost").search; },
    },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const react = {
    createElement: require("react").createElement,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: unknown) => { slots[index] = value; }];
    },
    useRef: (value: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: value };
      return slots[index];
    },
    useCallback: (fn: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = fn;
      return slots[index];
    },
    useEffect: (effect: () => (() => void)) => {
      const index = cursor++;
      if (!(index in slots)) { slots[index] = true; cleanups.push(effect()); }
    },
  };
  type View = { selectedMailboxId: string; switchingMailboxId: string | null; mailboxSwitchError: string | null; onMailboxChange: (id: string) => void; onMailboxSnapshot: (id: string, emails: EmailInboxBackendData["emails"]) => void; initialEmails: EmailInboxBackendData["emails"]; initialThreadId?: string; initialAgentDraft?: string };
  const exports = {} as { EmailAccountsWorkspace: (props: unknown) => { props: View } };
  const dependencies: Record<string, unknown> = { react, "@/components/email-inbox": { EmailInboxWorkspace: () => null } };
  const code = ts.transpileModule(readFileSync(new URL("../components/email-accounts-workspace.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: (name: string) => dependencies[name] ?? require(name), window, URLSearchParams, AbortController, AbortSignal: signalStatics, DOMException, Error, Date: Clock,
    setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: time.now + delay, callback }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    fetch: (url: string, options: { signal: AbortSignal }) => new Promise<Response>((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      requests.push({ url, signal: options.signal, resolve });
    }),
  });
  const initialData = snapshot("mine");
  const render = () => {
    cursor = 0;
    return exports.EmailAccountsWorkspace({ initialData, products: [], catalogs: [], initialThreadId: "original-thread", initialAgentDraft: "original-draft" }).props;
  };
  render();
  const elapse = (milliseconds: number) => {
    time.now += milliseconds;
    for (const [id, timer] of timers) {
      if (timer.at <= time.now) { timers.delete(id); timer.callback(); }
    }
  };
  return { render, requests, history, location, time, timers, elapse, back: () => listeners.get("popstate")!(), unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}

test("mailbox switching works without AbortSignal.any or AbortSignal.timeout", async () => {
  const ui = mount({});
  assert.equal(ui.requests.length, 2);
  ui.render().onMailboxChange("team");
  ui.requests[0].resolve(Response.json(snapshot("team")));
  await tick();
  assert.equal(ui.render().selectedMailboxId, "team");
  assert.equal(ui.render().mailboxSwitchError, null);
  assert.equal(ui.timers.size, 1, "The completed request clears its timeout");
  ui.elapse(30_000);
  await tick();
  assert.equal(ui.requests[0].signal.aborted, false, "A completed request must not be aborted later");
  ui.unmount();
});

test("a stalled mailbox request times out after 30 seconds and can be retried", async () => {
  const ui = mount({});
  ui.render().onMailboxChange("team");
  ui.elapse(29_999);
  assert.equal(ui.requests[0].signal.aborted, false);
  ui.elapse(1);
  await tick();
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.render().selectedMailboxId, "mine");
  assert.match(ui.render().mailboxSwitchError!, /timed out/i);
  assert.equal(ui.render().switchingMailboxId, null);
  assert.equal(ui.timers.size, 0);
  ui.render().onMailboxChange("team");
  assert.equal(ui.requests.length, 3, "Retry starts a new request");
  ui.requests[2].resolve(Response.json(snapshot("team")));
  await tick();
  assert.equal(ui.render().selectedMailboxId, "team");
  assert.equal(ui.render().mailboxSwitchError, null);
  assert.equal(ui.timers.size, 0);
  ui.unmount();
});

test("other inboxes preload once and switching reuses their in-flight request", async () => {
  const ui = mount();
  assert.equal(ui.requests.length, 2);
  ui.render().onMailboxChange("team");
  assert.equal(ui.render().switchingMailboxId, "team");
  assert.equal(ui.render().selectedMailboxId, "mine");
  assert.equal(ui.requests[0].url, "/api/email/inbox?mailboxId=team&refresh=false");
  assert.equal(ui.requests.length, 2, "Clicking must not duplicate the preload");
  ui.requests[0].resolve(Response.json(snapshot("team")));
  await tick();
  assert.equal(ui.render().selectedMailboxId, "team");
  assert.equal(ui.render().switchingMailboxId, null);
  assert.equal(ui.render().initialThreadId, undefined);
  assert.equal(ui.render().initialAgentDraft, undefined);
  assert.deepEqual(ui.history, ["/emails?mailbox=team"]);
  ui.render().onMailboxChange("mine");
  assert.equal(ui.render().selectedMailboxId, "mine");
  assert.equal(ui.requests.length, 2);
  ui.unmount();
});

test("rapid switches ignore a late response from the abandoned account", async () => {
  const ui = mount();
  ui.render().onMailboxChange("team");
  ui.render().onMailboxChange("other");
  assert.equal(ui.requests[0].signal.aborted, false, "An abandoned selection can finish warming its account");
  ui.requests[1].resolve(Response.json(snapshot("other")));
  await tick();
  ui.requests[0].resolve(Response.json(snapshot("team")));
  await tick();
  assert.equal(ui.render().selectedMailboxId, "other");
  assert.deepEqual(ui.history, ["/emails?mailbox=other"]);
  ui.unmount();
});

test("read state and opened message content remain cached when switching after several minutes", async () => {
  const ui = mount();
  const email = { id: "read-message", contact: "buyer@example.com", direction: "inbound" as const, status: "Received", subject: "Hello", company: "Buyer", preview: "Message", body: "Loaded message content", timestamp: "2026-10-28T00:00:00Z", read: true, bodyLoaded: true };
  ui.render().onMailboxSnapshot("mine", [email]);
  ui.render().onMailboxChange("team");
  ui.requests[0].resolve(Response.json(snapshot("team")));
  await tick();
  ui.time.now += 120_000;
  ui.render().onMailboxChange("mine");
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.render().selectedMailboxId, "mine");
  assert.equal(ui.render().switchingMailboxId, null);
  assert.equal(ui.render().initialEmails[0].read, true);
  assert.equal(ui.render().initialEmails[0].body, "Loaded message content");
  ui.unmount();
});

test("selecting the current tab cancels a pending switch", async () => {
  const ui = mount();
  ui.render().onMailboxChange("team");
  ui.render().onMailboxChange("mine");
  ui.requests[0].resolve(Response.json(snapshot("team")));
  await tick();
  assert.equal(ui.render().selectedMailboxId, "mine");
  assert.equal(ui.render().switchingMailboxId, null);
  assert.equal(ui.history.length, 0);
  ui.unmount();
});

test("failed and mismatched responses retain the existing inbox and report an error", async () => {
  for (const response of [Response.json({ error: "Mailbox unavailable." }, { status: 404 }), Response.json(snapshot("other"))]) {
    const ui = mount();
    ui.render().onMailboxChange("team");
    ui.requests[0].resolve(response);
    await tick();
    assert.equal(ui.render().selectedMailboxId, "mine");
    assert.ok(ui.render().mailboxSwitchError);
    assert.equal(ui.render().switchingMailboxId, null);
    assert.equal(ui.history.length, 0);
    ui.unmount();
  }
});

test("browser back switches accounts without pushing another history entry", async () => {
  const ui = mount();
  ui.location.search = "?mailbox=team";
  ui.back();
  ui.requests[0].resolve(Response.json(snapshot("team")));
  await tick();
  assert.equal(ui.render().selectedMailboxId, "team");
  ui.location.search = "";
  ui.back();
  assert.equal(ui.render().selectedMailboxId, "mine");
  assert.equal(ui.history.length, 0);
  ui.unmount();
});

test("leaving the workspace cancels the account request", async () => {
  const ui = mount();
  ui.render().onMailboxChange("team");
  ui.unmount();
  assert.equal(ui.requests[0].signal.aborted, true);
  assert.equal(ui.requests[1].signal.aborted, true);
  await tick();
  assert.equal(ui.timers.size, 0);
});

test("a preloaded account opens synchronously without a spinner or another request", async () => {
  const ui = mount();
  ui.requests[0].resolve(Response.json(snapshot("team")));
  await tick();
  ui.render().onMailboxChange("team");
  assert.equal(ui.render().selectedMailboxId, "team");
  assert.equal(ui.render().switchingMailboxId, null);
  assert.equal(ui.requests.length, 2);
  ui.unmount();
});
