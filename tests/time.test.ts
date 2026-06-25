import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addJstDays,
  formatJstDate,
  formatJstTime,
  getJstDateParts,
  isLastDayOfMonthJst,
  jstDayRangeAsUtc,
  jstDayRangeForReportAsUtc,
  millisecondsUntilNextJst,
  monthRangeJstAsUtc,
} from "../src/lib/time.js";

describe("JST time helpers", () => {
  it("formats UTC timestamps as JST dates and times", () => {
    const date = new Date("2026-06-21T15:30:00.000Z");

    assert.equal(formatJstDate(date), "2026年06月22日");
    assert.equal(formatJstTime(date), "00:30");
    assert.deepEqual(getJstDateParts(date), {
      year: 2026,
      month: 6,
      day: 22,
    });
  });

  it("returns the UTC range for a JST day", () => {
    const { start, end } = jstDayRangeAsUtc(
      new Date("2026-06-22T14:59:30.000Z"),
    );

    assert.equal(start.toISOString(), "2026-06-21T15:00:00.000Z");
    assert.equal(end.toISOString(), "2026-06-22T15:00:00.000Z");
  });

  it("returns the UTC range for the report window from 22:16 JST to 22:15 JST", () => {
    const { start, end } = jstDayRangeForReportAsUtc(
      new Date("2026-06-21T13:15:00.000Z"),
    );

    assert.equal(start.toISOString(), "2026-06-20T13:16:00.000Z");
    assert.equal(end.toISOString(), "2026-06-21T13:15:00.000Z");
  });

  it("moves dates by JST calendar days", () => {
    assert.equal(
      formatJstDate(addJstDays(new Date("2026-07-01T00:30:00.000Z"), -1)),
      "2026年06月30日",
    );
  });

  it("returns the UTC range for a JST month", () => {
    const { start, end } = monthRangeJstAsUtc(2026, 12);

    assert.equal(start.toISOString(), "2026-11-30T15:00:00.000Z");
    assert.equal(end.toISOString(), "2026-12-31T15:00:00.000Z");
  });

  it("detects the last day of the month in JST", () => {
    assert.equal(
      isLastDayOfMonthJst(new Date("2026-06-30T14:59:00.000Z")),
      true,
    );
    assert.equal(
      isLastDayOfMonthJst(new Date("2026-06-30T15:00:00.000Z")),
      false,
    );
  });

  it("calculates the next scheduled JST run", () => {
    assert.equal(
      millisecondsUntilNextJst(23, 59, new Date("2026-06-22T14:58:00.000Z")),
      60 * 1000,
    );
    assert.equal(
      millisecondsUntilNextJst(23, 59, new Date("2026-06-22T14:59:00.000Z")),
      24 * 60 * 60 * 1000,
    );
  });
});
