import assert from "node:assert/strict";
import test from "node:test";
import { parsePickerDate, pickerDateValue, pickerSelection, validPickerValue } from "../lib/date-picker.ts";

test("date-only values round-trip as local calendar days without UTC conversion", () => {
  for (const value of ["2026-01-01", "2026-10-30", "2028-02-29", "0099-12-31"]) {
    const date = parsePickerDate(value)!;
    assert.ok(date);
    assert.equal(date.getHours(), 0);
    assert.equal(pickerDateValue(date), value);
  }
  assert.equal(pickerDateValue(parsePickerDate("2026-10-30T23:45")!), "2026-10-30");
  for (const value of ["", "2026-02-29", "2026-13-01", "2026-04-31", "2026-00-01", "2026-10-00", "10/30/2026"]) {
    assert.equal(parsePickerDate(value), undefined);
  }
});

test("changing a scheduled day preserves the exact existing local time", () => {
  const day = parsePickerDate("2026-11-02")!;
  assert.equal(pickerSelection(day, "2026-10-30T23:45:12.123", true), "2026-11-02T23:45:12.123");
  assert.equal(pickerSelection(day, "", true), "2026-11-02T09:00");
  assert.equal(pickerSelection(day, "2026-10-30T23:45", false), "2026-11-02");
});

test("invoice and reporting date limits are inclusive and invalid dates cannot pass validation", () => {
  assert.equal(validPickerValue("2026-10-30", false, "2026-10-01", "2026-10-30"), true);
  assert.equal(validPickerValue("2026-10-01", false, "2026-10-01", "2026-10-30"), true);
  assert.equal(validPickerValue("2026-09-30", false, "2026-10-01", "2026-10-30"), false);
  assert.equal(validPickerValue("2026-10-31", false, undefined, "2026-10-30"), false);
  assert.equal(validPickerValue("2026-02-30", false), false);
  assert.equal(validPickerValue("2026-10-30T10:30", false), false);
  assert.equal(validPickerValue("", false), true);
});

test("scheduled time bounds and malformed time values are validated", () => {
  assert.equal(validPickerValue("2026-10-30T10:30", true, "2026-10-30T10:00", "2026-10-30T11:00"), true);
  assert.equal(validPickerValue("2026-10-30T09:59", true, "2026-10-30T10:00"), false);
  for (const value of ["2026-10-30", "2026-10-30T24:00", "2026-10-30T12:60", "2026-10-30T12:30:60", "2026-10-30Tnoon"]) {
    assert.equal(validPickerValue(value, true), false);
  }
});
