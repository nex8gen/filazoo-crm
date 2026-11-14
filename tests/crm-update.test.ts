import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkLocalDependencies } from "../scripts/check-local-dependencies.mjs";
import { assertCurrentLocalBuild, localBuildFingerprint, saveLocalBuild } from "../scripts/local-build-state.mjs";
import { syncCrmSource } from "../scripts/update-crm.mjs";
import { crmRuntimePlan } from "../scripts/start-crm.mjs";

test("missing and mismatched pinned dependencies stop startup with update instructions", () => {
  const root = mkdtempSync(path.join(tmpdir(), "crm-dependencies-"));
  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { streamdown: "^2.7.1" }, devDependencies: { jsdom: "31.0.0" } }));
    writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/streamdown": { version: "2.7.1" }, "node_modules/jsdom": { version: "31.0.0" } } }));
    assert.throws(() => checkLocalDependencies(root), /streamdown, jsdom.*npm ci/);
    for (const [name, version] of [["streamdown", "2.7.1"], ["jsdom", "30.0.0"]]) {
      mkdirSync(path.join(root, "node_modules", name), { recursive: true });
      writeFileSync(path.join(root, "node_modules", name, "package.json"), JSON.stringify({ version }));
    }
    assert.throws(() => checkLocalDependencies(root), /jsdom/);
    writeFileSync(path.join(root, "node_modules/jsdom/package.json"), JSON.stringify({ version: "31.0.0" }));
    assert.doesNotThrow(() => checkLocalDependencies(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("restart refuses stale code, untracked app additions, changed configuration and replaced build output", () => {
  const root = mkdtempSync(path.join(tmpdir(), "crm-build-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init");
    mkdirSync(path.join(root, "app"));
    mkdirSync(path.join(root, ".next-crm"));
    writeFileSync(path.join(root, ".gitignore"), ".next-crm/\n.env*\n");
    writeFileSync(path.join(root, "app/page.tsx"), "original source");
    git("add", ".");
    git("-c", "user.name=CRM test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
    const fingerprint = () => localBuildFingerprint(root, {});
    assert.throws(() => assertCurrentLocalBuild(root, fingerprint()), /No verified/);
    writeFileSync(path.join(root, ".next-crm/BUILD_ID"), "original-build");
    saveLocalBuild(root, fingerprint());
    assert.doesNotThrow(() => assertCurrentLocalBuild(root, fingerprint()));
    for (const [file, content] of [["app/page.tsx", "new source"], ["app/new.tsx", "untracked page"], [".env.local", "PRIVATE_VALUE=keep-this-secret"], [".next-crm/BUILD_ID", "other-build"]]) {
      const target = path.join(root, file);
      let previous: string | undefined;
      try { previous = readFileSync(target, "utf8"); } catch { /* New file. */ }
      writeFileSync(target, content);
      assert.throws(() => assertCurrentLocalBuild(root, fingerprint()), /older than/, file);
      if (previous === undefined) rmSync(target); else writeFileSync(target, previous);
      assert.doesNotThrow(() => assertCurrentLocalBuild(root, fingerprint()));
    }
    assert.doesNotMatch(readFileSync(path.join(root, ".next-crm/local-release.json"), "utf8"), /PRIVATE_VALUE|original source/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function sourceRunner({ branch = "main", counts = "0 0", dirty = "", failures = [] as string[] } = {}) {
  const commands: string[][] = [];
  const run = async (_command: string, args: string[]) => {
    commands.push(args);
    if (args.includes("fetch")) { const error = failures.shift(); if (error) throw new Error(error); return ""; }
    if (args[0] === "branch") return branch;
    if (args[0] === "rev-list") return counts;
    if (args[0] === "status") return dirty;
    return "a6b046e";
  };
  return { run, commands };
}

test("update retries interrupted downloads and only fast-forwards after a successful fetch", async () => {
  const fixture = sourceRunner({ counts: "0 2", failures: ["RPC failed; curl 18 Transferred a partial file", "fatal: early EOF"] });
  const waits: number[] = [];
  assert.equal(await syncCrmSource(fixture.run, async (ms: number) => { waits.push(ms); }), "a6b046e");
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(fixture.commands.filter(args => args.includes("fetch")).length, 3);
  assert.deepEqual(fixture.commands.find(args => args[0] === "merge"), ["merge", "--ff-only", "origin/main"]);
  assert.ok(fixture.commands.every(args => !args.includes("reset") && !args.includes("stash")));
});

test("update preserves local work and stops for branches, divergent commits, edits and authentication failures", async () => {
  for (const [options, expected] of [
    [{ branch: "feature" }, /Switch to main/],
    [{ counts: "1 2" }, /commits absent/],
    [{ counts: "0 2", dirty: " M app/page.tsx" }, /local files have edits/],
    [{ failures: ["Authentication failed"] }, /Authentication failed/],
    [{ failures: ["early EOF", "early EOF", "early EOF"] }, /early EOF/],
  ] as const) {
    const fixture = sourceRunner({ ...options, ...("failures" in options ? { failures: [...options.failures] } : {}) });
    await assert.rejects(syncCrmSource(fixture.run, async () => {}), expected);
    assert.equal(fixture.commands.some(args => args[0] === "merge"), false);
  }
  const current = sourceRunner({ dirty: " M app/page.tsx" });
  await syncCrmSource(current.run);
  assert.equal(current.commands.some(args => args[0] === "merge"), false);
});

test("update can prepare a build without launching a server", () => {
  const plan = crmRuntimePlan(["--build-only"], {});
  assert.equal(plan.build, true);
  assert.equal(plan.commands.some(command => command.includes("start")), false);
  assert.throws(() => crmRuntimePlan(["--build-only", "--skip-build"], {}));
});
