import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceNavigation } from "../lib/workspace-navigation.ts";
import { loginDestination } from "../lib/login-destination.ts";

function session() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("fresh sessions open Home, and later navigation and refresh stay on the selected page", () => {
  const storage = session();
  const first = createWorkspaceNavigation("staff");
  assert.equal(first.visit("/email?folder=inbox", storage), "/");
  assert.equal(first.getSnapshot(), "/");
  assert.equal(first.visit("/", storage), null);
  assert.equal(first.visit("/email?folder=sent", storage), null);
  const refresh = createWorkspaceNavigation("staff");
  assert.equal(refresh.visit("/email?folder=sent", storage), null);
  assert.equal(refresh.getSnapshot(), "/email?folder=sent");
  assert.equal(createWorkspaceNavigation("staff").visit("/email", session()), "/");
});

test("Settings returns to the originating record with filters and hash across sections and reloads", () => {
  const storage = session();
  const navigation = createWorkspaceNavigation("staff");
  navigation.visit("/", storage);
  const origin = "/companies/company-id?tab=email&page=3#conversation";
  navigation.visit(origin, storage);
  for (const settings of ["/settings", "/settings/appearance", "/settings/apps/gmail?connected=1"]) {
    assert.equal(navigation.visit(settings, storage), null);
    assert.equal(navigation.getSnapshot(), origin);
  }
  const refreshed = createWorkspaceNavigation("staff");
  assert.equal(refreshed.visit("/settings/appearance", storage), null);
  assert.equal(refreshed.getSnapshot(), origin);
  refreshed.visit("/products?search=PLA", storage);
  refreshed.visit("/settings/ai", storage);
  assert.equal(refreshed.getSnapshot(), "/products?search=PLA");
});

test("Home remains the Settings return page when Settings was opened from Home", () => {
  const storage = session();
  const navigation = createWorkspaceNavigation("staff");
  navigation.visit("/", storage);
  navigation.visit("/settings", storage);
  assert.equal(navigation.getSnapshot(), "/");
});

test("auth, onboarding and customer pages never become the Settings return destination", () => {
  const storage = session();
  const navigation = createWorkspaceNavigation("staff");
  for (const path of ["/login", "/workspaces/new", "/join/token", "/customer/invoice"]) {
    assert.equal(navigation.visit(path, storage), null);
  }
  assert.equal(navigation.visit("/settings", storage), "/");
  navigation.visit("/", storage);
  navigation.visit("/email", storage);
  navigation.visit("/workspaces", storage);
  navigation.visit("/settings", storage);
  assert.equal(navigation.getSnapshot(), "/email");
});

test("accounts have separate session navigation", () => {
  const storage = session();
  const first = createWorkspaceNavigation("first");
  first.visit("/", storage); first.visit("/email", storage);
  const second = createWorkspaceNavigation("second");
  assert.equal(second.visit("/settings", storage), "/");
  assert.equal(second.getSnapshot(), "/");
  const restored = createWorkspaceNavigation("first");
  restored.visit("/settings", storage);
  assert.equal(restored.getSnapshot(), "/email");
});

test("unavailable storage keeps navigation working without redirect loops", () => {
  const unavailable = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  for (const storage of [null, unavailable]) {
    const navigation = createWorkspaceNavigation("staff");
    assert.equal(navigation.visit("/settings", storage), "/");
    assert.equal(navigation.visit("/", storage), null);
    assert.equal(navigation.visit("/email", storage), null);
    navigation.visit("/settings", storage);
    assert.equal(navigation.getSnapshot(), "/email");
  }
});

test("invalid stored return locations fall back to Home", () => {
  for (const value of ["not json", "null", JSON.stringify({ started: true, lastPage: "https://attacker.test" }), JSON.stringify({ started: true, lastPage: "//attacker.test" }), JSON.stringify({ started: true, lastPage: "/settings/ai" }), JSON.stringify({ started: true, lastPage: "/login" })]) {
    const storage = { getItem: () => value, setItem() {} };
    const navigation = createWorkspaceNavigation("staff");
    navigation.visit("/settings", storage);
    assert.equal(navigation.getSnapshot(), "/");
  }
});

test("subscribers update the Settings link after navigation and stop after unmount", () => {
  const navigation = createWorkspaceNavigation("staff");
  let updates = 0;
  const unsubscribe = navigation.subscribe(() => updates++);
  navigation.visit("/", null);
  navigation.visit("/email", null);
  navigation.visit("/settings", null);
  assert.equal(updates, 1);
  unsubscribe();
  navigation.visit("/products", null);
  assert.equal(updates, 1);
});

test("login redirects cover social callbacks, onboarding and password recovery safely", () => {
  for (const path of [undefined, "/", "/analytics", "/email", "/settings/team", "/companies/123?tab=notes", "https://attacker.test", "//attacker.test", "/\\attacker.test", "/login", "/workspaces-evil"]) {
    assert.equal(loginDestination(path), "/");
  }
  for (const path of ["/update-password", "/workspaces/new", "/workspaces/setup", "/join/token", "/accept-invitation?token=abc"]) {
    assert.equal(loginDestination(path), path);
  }
});
