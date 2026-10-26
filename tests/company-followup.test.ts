import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { followupInstant, followupLocalTime } from "../lib/company-followup.ts";

test("empty and invalid follow-up dates stay empty", () => {
  assert.equal(followupInstant(""), "");
  assert.equal(followupInstant("invalid"), "");
  assert.equal(followupLocalTime(null), "");
  assert.equal(followupLocalTime("invalid"), "");
});

test("browser follow-up times round-trip in China, UTC and daylight-saving zones", () => {
  for (const [zone, input, expected] of [
    ["Asia/Shanghai", "2026-10-27T09:30", "2026-10-27T01:30:00.000Z"],
    ["UTC", "2026-10-27T09:30", "2026-10-27T09:30:00.000Z"],
    ["America/New_York", "2026-07-15T09:30", "2026-07-15T13:30:00.000Z"],
    ["America/New_York", "2026-12-15T09:30", "2026-12-15T14:30:00.000Z"],
  ]) {
    const script = `import {followupInstant,followupLocalTime} from './lib/company-followup.ts'; const instant=followupInstant(${JSON.stringify(input)}); console.log(JSON.stringify([instant,followupLocalTime(instant)]));`;
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { env: { ...process.env, TZ: zone }, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), [expected, input], zone);
  }
});
