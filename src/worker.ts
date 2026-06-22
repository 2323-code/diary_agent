import {
  generateDailyReport,
  generateMonthlyReport,
  resolveManualDailyTarget,
  runScheduledReports,
  type ReportEnv,
} from "./lib/report.js";
import { getJstDateParts } from "./lib/time.js";

type Env = ReportEnv & {
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_ALLOWED_USER_IDS?: string;
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type ScheduledEvent = {
  scheduledTime: number;
  cron: string;
};

type DiscordInteraction = {
  id: string;
  application_id: string;
  token: string;
  type: number;
  channel_id?: string;
  member?: {
    user?: {
      id: string;
    };
  };
  user?: {
    id: string;
  };
  data?: {
    name?: string;
  };
};

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const INTERACTION_RESPONSE_PONG = 1;
const INTERACTION_RESPONSE_CHANNEL_MESSAGE = 4;
const INTERACTION_RESPONSE_DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL_FLAG = 64;
const DISCORD_API_BASE = "https://discord.com/api/v10";

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function parseAllowedUserIds(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }

  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function verifyDiscordRequest(request: Request, env: Env, body: string): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(env.DISCORD_PUBLIC_KEY),
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const payload = new TextEncoder().encode(`${timestamp}${body}`);
  return crypto.subtle.verify("Ed25519", key, hexToBytes(signature), payload);
}

function canRunManualCommand(interaction: DiscordInteraction, env: Env): boolean {
  if (interaction.channel_id !== env.DISCORD_REPORT_CHANNEL_ID) {
    return false;
  }

  const allowedUserIds = parseAllowedUserIds(env.DISCORD_ALLOWED_USER_IDS);
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  return allowedUserIds.length === 0 || (userId ? allowedUserIds.includes(userId) : false);
}

async function editOriginalInteractionResponse(
  env: Env,
  interaction: DiscordInteraction,
  content: string,
): Promise<void> {
  await fetch(
    `${DISCORD_API_BASE}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    },
  );
}

async function runManualCommand(env: Env, interaction: DiscordInteraction): Promise<void> {
  const commandName = interaction.data?.name;

  try {
    if (commandName === "daily_report" || commandName === "daily_report_yesterday") {
      await generateDailyReport(env, resolveManualDailyTarget(commandName));
      await editOriginalInteractionResponse(env, interaction, "日報を投稿しました。");
      return;
    }

    if (commandName === "monthly_report") {
      const { year, month } = getJstDateParts();
      await generateMonthlyReport(env, year, month);
      await editOriginalInteractionResponse(env, interaction, "月次サマリーを投稿しました。");
      return;
    }

    await editOriginalInteractionResponse(env, interaction, "未対応のコマンドです。");
  } catch (error) {
    console.error("manual command failed:", error);
    await editOriginalInteractionResponse(
      env,
      interaction,
      "生成中にエラーが発生しました。Cloudflare Workers のログを確認してください。",
    );
  }
}

async function handleInteraction(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.text();
  const verified = await verifyDiscordRequest(request, env, body);
  if (!verified) {
    return new Response("Bad request signature", { status: 401 });
  }

  const interaction = JSON.parse(body) as DiscordInteraction;

  if (interaction.type === INTERACTION_TYPE_PING) {
    return json({ type: INTERACTION_RESPONSE_PONG });
  }

  if (interaction.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
    return json({
      type: INTERACTION_RESPONSE_CHANNEL_MESSAGE,
      data: { content: "未対応のInteractionです。", flags: EPHEMERAL_FLAG },
    });
  }

  if (!canRunManualCommand(interaction, env)) {
    return json({
      type: INTERACTION_RESPONSE_CHANNEL_MESSAGE,
      data: {
        content: "このコマンドは許可された日報チャンネル/ユーザーからのみ実行できます。",
        flags: EPHEMERAL_FLAG,
      },
    });
  }

  ctx.waitUntil(runManualCommand(env, interaction));
  return json({
    type: INTERACTION_RESPONSE_DEFERRED_CHANNEL_MESSAGE,
    data: { content: "生成中..." },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/discord/interactions") {
      return handleInteraction(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.info(`scheduled event: ${event.cron}`);
    ctx.waitUntil(runScheduledReports(env, new Date(event.scheduledTime)));
  },
};
