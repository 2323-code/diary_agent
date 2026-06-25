import Anthropic from "@anthropic-ai/sdk";

import {
  DISCORD_LIMIT,
  SAFE_DISCORD_LIMIT,
  splitDiscordMessage,
} from "./discord.js";
import {
  addJstDays,
  formatJstDate,
  formatJstMonth,
  formatJstTime,
  getJstDateParts,
  isLastDayOfMonthJst,
  jstDayRangeForReportAsUtc,
  monthRangeJstAsUtc,
} from "./time.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export type ReportEnv = {
  DISCORD_BOT_TOKEN: string;
  DISCORD_MEMO_CHANNEL_ID: string;
  DISCORD_REPORT_CHANNEL_ID: string;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL?: string;
};

type DiscordUser = {
  id: string;
  bot?: boolean;
};

type DiscordMessage = {
  id: string;
  content: string;
  timestamp: string;
  author: DiscordUser;
};

type DiscordApiError = {
  message?: string;
  code?: number;
};

async function discordRequest<T>(
  env: ReportEnv,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    let detail: DiscordApiError | string = await response.text();
    try {
      detail = JSON.parse(String(detail)) as DiscordApiError;
    } catch {
      // Keep the raw body.
    }
    throw new Error(
      `Discord API error ${response.status}: ${JSON.stringify(detail)}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function sendDiscordMessage(
  env: ReportEnv,
  channelId: string,
  content: string,
): Promise<void> {
  await discordRequest(env, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

async function fetchChannelMessages(
  env: ReportEnv,
  channelId: string,
  options: { before?: string; limit?: number } = {},
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.before) {
    params.set("before", options.before);
  }

  return discordRequest<DiscordMessage[]>(
    env,
    `/channels/${channelId}/messages?${params.toString()}`,
  );
}

async function fetchBotUserId(env: ReportEnv): Promise<string> {
  const user = await discordRequest<DiscordUser>(env, "/users/@me");
  return user.id;
}

function extractClaudeText(response: Anthropic.Messages.Message): string {
  return response.content
    .filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function callClaude(
  env: ReportEnv,
  system: string,
  user: string,
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
  });

  return extractClaudeText(response);
}

async function fetchMemosForJstDate(
  env: ReportEnv,
  targetDate: Date,
): Promise<string[]> {
  const { start, end } = jstDayRangeForReportAsUtc(targetDate);
  const messages: DiscordMessage[] = [];
  let before: string | undefined;

  while (true) {
    const batch = await fetchChannelMessages(env, env.DISCORD_MEMO_CHANNEL_ID, {
      before,
    });
    if (batch.length === 0) {
      break;
    }

    const sorted = [...batch].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    messages.push(
      ...sorted.filter((message) => {
        const createdAt = new Date(message.timestamp);
        return createdAt >= start && createdAt < end;
      }),
    );

    const oldest = sorted.at(-1);
    if (!oldest || new Date(oldest.timestamp) < start) {
      break;
    }

    before = oldest.id;
  }

  return messages
    .filter((message) => !message.author.bot)
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
    .map(
      (message) =>
        `[${formatJstTime(new Date(message.timestamp))}] ${message.content}`,
    )
    .filter((line) => line.trim().length > 8);
}

async function fetchMonthReports(
  env: ReportEnv,
  year: number,
  month: number,
): Promise<string[]> {
  const { start, end } = monthRangeJstAsUtc(year, month);
  const botUserId = await fetchBotUserId(env);
  const reports: string[] = [];
  let before: string | undefined;

  while (true) {
    const batch = await fetchChannelMessages(
      env,
      env.DISCORD_REPORT_CHANNEL_ID,
      { before },
    );
    if (batch.length === 0) {
      break;
    }

    const sorted = [...batch].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    for (const message of sorted) {
      const createdAt = new Date(message.timestamp);
      if (createdAt < start) {
        return reports.reverse();
      }

      if (
        createdAt >= start &&
        createdAt < end &&
        message.author.id === botUserId &&
        message.content.startsWith("📋")
      ) {
        reports.push(message.content);
      }
    }

    const oldest = sorted.at(-1);
    if (!oldest) {
      break;
    }

    before = oldest.id;
  }

  return reports.reverse();
}

export async function generateDailyReport(
  env: ReportEnv,
  targetDate = new Date(),
): Promise<void> {
  const memos = await fetchMemosForJstDate(env, targetDate);
  const todayStr = formatJstDate(targetDate);

  if (memos.length === 0) {
    await sendDiscordMessage(
      env,
      env.DISCORD_REPORT_CHANNEL_ID,
      `📋 **${todayStr}の日報**\n\n今日は雑記が記録されていませんでした。`,
    );
    return;
  }

  const systemPrompt = `あなたは日報作成アシスタントです。
Discordの雑記（times）から、簡潔でわかりやすい日報を生成してください。

出力フォーマット（Markdown）:
## やったこと
- 箇条書きで具体的な作業内容

## 気づき・メモ
- 作業中に感じたことや残しておきたいこと（なければ省略）

## 明日やること
- 雑記から読み取れる次のアクション（明確でなければ「未定」）

ルール:
- 記録内容をもとに作成し、根拠のない推測は追加しない
- ただし記録内容から自然に導き出せることは含めてもよい
- 敬語不要、簡潔に
- 重複をまとめる
- 時刻は参考程度に使い、時系列の羅列にしない`;

  const userPrompt = `${todayStr}の雑記:\n\n${memos.join("\n")}`;
  const reportBody = await callClaude(env, systemPrompt, userPrompt);
  let message = `📋 **${todayStr}の日報**\n\n${reportBody}`;
  if (message.length > SAFE_DISCORD_LIMIT) {
    message = `${message.slice(0, SAFE_DISCORD_LIMIT)}\n\n...(省略)`;
  }

  await sendDiscordMessage(
    env,
    env.DISCORD_REPORT_CHANNEL_ID,
    message.slice(0, DISCORD_LIMIT),
  );
}

export async function generateMonthlyReport(
  env: ReportEnv,
  year: number,
  month: number,
): Promise<void> {
  const reports = await fetchMonthReports(env, year, month);
  const monthStr = formatJstMonth(year, month);

  if (reports.length === 0) {
    await sendDiscordMessage(
      env,
      env.DISCORD_REPORT_CHANNEL_ID,
      `📊 **${monthStr}の月次振り返り**\n\nこの月の日報が見つかりませんでした。`,
    );
    return;
  }

  const systemPrompt = `あなたは月次振り返りアシスタントです。
1ヶ月分の日報をもとに、月次の振り返りレポートを生成してください。

出力フォーマット（Markdown）:
## 今月のハイライト
- 特に重要だった成果や出来事（3〜5個）

## やったことまとめ
- カテゴリ別に分類して整理

## 気づき・学び
- 月を通して気づいたこと、学んだこと

## 来月に向けて
- 継続すること、改善したいこと

ルール:
- 日報の内容をもとに作成し、根拠のない推測は追加しない
- ただし日報内容から自然に導き出せることは含めてもよい
- 全日報を横断して重複をまとめる
- 細かすぎる作業は統合して書く
- ポジティブかつ具体的に`;

  const combinedReports = reports.join("\n\n---\n\n").slice(0, 6000);
  const userPrompt = `${monthStr}の日報一覧:\n\n${combinedReports}`;
  const summary = await callClaude(env, systemPrompt, userPrompt);
  const message = `📊 **${monthStr}の月次振り返り**\n\n${summary}`;

  for (const chunk of splitDiscordMessage(message)) {
    await sendDiscordMessage(env, env.DISCORD_REPORT_CHANNEL_ID, chunk);
  }
}

export async function runScheduledReports(
  env: ReportEnv,
  scheduledAt = new Date(),
): Promise<void> {
  await generateDailyReport(env, scheduledAt);

  if (isLastDayOfMonthJst(scheduledAt)) {
    const { year, month } = getJstDateParts(scheduledAt);
    await generateMonthlyReport(env, year, month);
  }
}

export function resolveManualDailyTarget(
  commandName: string,
  now = new Date(),
): Date {
  return commandName === "daily_report_yesterday" ? addJstDays(now, -1) : now;
}
