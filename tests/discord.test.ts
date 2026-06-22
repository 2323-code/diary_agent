import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DISCORD_LIMIT,
  SAFE_DISCORD_LIMIT,
  splitDiscordMessage,
  truncateDiscordMessage,
} from "../src/lib/discord.js";

describe("Discord message helpers", () => {
  it("keeps short messages intact", () => {
    assert.deepEqual(splitDiscordMessage("hello"), ["hello"]);
  });

  it("splits long messages below the Discord hard limit", () => {
    const chunks = splitDiscordMessage("a".repeat(SAFE_DISCORD_LIMIT + 10));

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, SAFE_DISCORD_LIMIT);
    assert.equal(chunks[1].length, 10);
    assert.ok(chunks.every((chunk) => chunk.length <= DISCORD_LIMIT));
  });

  it("truncates at the Discord hard limit", () => {
    assert.equal(truncateDiscordMessage("a".repeat(DISCORD_LIMIT + 1)).length, DISCORD_LIMIT);
  });
});
