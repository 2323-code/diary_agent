import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateDailyReport } from "../src/lib/report.js";

describe("Report generation", () => {
  it("posts a休み message and skips Claude when no Discord memo messages exist", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push({ url, init });

      if (url.includes("/channels/000000000000000000/messages")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/channels/000000000000000001/messages")) {
        assert.ok(init?.body, "Report post request must include a body");
        const body = JSON.parse(String(init.body));
        assert.equal(
          body.content,
          "📋 **2026年06月22日の日報**\n\n今日の日報はお休みです",
        );
        return new Response(JSON.stringify({ id: "1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    };

    const env = {
      DISCORD_BOT_TOKEN: "token",
      DISCORD_MEMO_CHANNEL_ID: "000000000000000000",
      DISCORD_REPORT_CHANNEL_ID: "000000000000000001",
      ANTHROPIC_API_KEY: "api",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
    };

    await generateDailyReport(env, new Date("2026-06-22T13:30:00.000Z"));

    assert.equal(
      calls.some((call) => call.url.includes("anthropic.ai")),
      false,
    );
  });
});
