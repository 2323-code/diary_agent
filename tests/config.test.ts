import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCsvEnv } from "../src/lib/config.js";

describe("config helpers", () => {
  it("parses comma-separated IDs", () => {
    assert.deepEqual(parseCsvEnv("111, 222,,333 "), ["111", "222", "333"]);
  });

  it("returns an empty list for missing values", () => {
    assert.deepEqual(parseCsvEnv(undefined), []);
    assert.deepEqual(parseCsvEnv(""), []);
  });
});
