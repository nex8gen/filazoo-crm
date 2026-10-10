import assert from "node:assert/strict";
import test from "node:test";
import { passwordSchema } from "../lib/password.ts";

test("accepts a strong CRM password", () => {
  assert.equal(passwordSchema.safeParse("Filazoo!Secure2026").success, true);
});

test("rejects short or incomplete passwords", () => {
  for (const password of ["Short1!", "alllowercase1!", "ALLUPPERCASE1!", "NoNumberHere!", "NoSymbolHere1"]) {
    assert.equal(passwordSchema.safeParse(password).success, false, password);
  }
});
