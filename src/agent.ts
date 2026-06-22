/**
 * Discord Daily Report Agent
 *
 * - 毎日23:59 JSTに雑記チャンネルを取得してClaude APIで日報を生成
 * - 月末23:59 JSTに日報チャンネルの内容を集約して月次サマリーを生成
 */

import "dotenv/config";

import Anthropic from "@anthropic-ai/sdk";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
  TextChannel,
} from "discord.js";

import { loadEnv, type RequiredEnv } from "./lib/config.js";
import {
  DISCORD_LIMIT,
  SAFE_DISCORD_LIMIT,
  splitDiscordMessage,
} from "./lib/discord.js";
import {
  addJstDays,
  formatJstDate,
  formatJstMonth,
  formatJstTime,
  getJstDateParts,
  isLastDayOfMonthJst,
  jstDayRangeAsUtc,
  millisecondsUntilNextJst,
  monthRangeJstAsUtc,
} from "./lib/time.js";

function extractClaudeText(response: Anthropic.Messages.Message): string {
  return response.content
    .filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export class ReportAgent {
  private readonly client: Client;
  private readonly anthropic: Anthropic;
  private readonly env: RequiredEnv;
  private dailyTimer?: NodeJS.Timeout;
  private dailyRun?: Promise<void>;
  private monthlyRun?: Promise<void>;

  constructor(env: RequiredEnv) {
    this.env = env;
    this.anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });

    this.client.once(Events.ClientReady, (readyClient) => {
      console.info(`Bot ready: ${readyClient.user.tag}`);
      this.scheduleNextDailyRun();
    });

    this.client.on(Events.MessageCreate, async (message) => {
      await this.onMessage(message);
    });

    process.once("SIGINT", () => this.shutdown("SIGINT"));
    process.once("SIGTERM", () => this.shutdown("SIGTERM"));
  }

  async start(): Promise<void> {
    await this.client.login(this.env.discordBotToken);
  }

  private async onMessage(message: Message): Promise<void> {
    if (message.author.bot) {
      return;
    }

    if (
      message.content !== "!daily_report" &&
      message.content !== "!daily_report_yesterday" &&
      message.content !== "!monthly_report"
    ) {
      return;
    }

    if (!this.canRunManualCommand(message)) {
      await message.reply("このコマンドは許可された日報チャンネル/ユーザーからのみ実行できます。");
      return;
    }

    if (message.content === "!daily_report") {
      console.info("手動トリガー: 日報生成");
      if (this.dailyRun) {
        await message.reply("日報はすでに生成中です。");
        return;
      }
      await message.reply("日報を生成中...");
      await this.runDailyReport(new Date());
      return;
    }

    if (message.content === "!daily_report_yesterday") {
      console.info("手動トリガー: 昨日分の日報生成");
      if (this.dailyRun) {
        await message.reply("日報はすでに生成中です。");
        return;
      }
      await message.reply("昨日分の日報を生成中...");
      await this.runDailyReport(addJstDays(new Date(), -1));
      return;
    }

    if (message.content === "!monthly_report") {
      console.info("手動トリガー: 月次サマリー生成");
      if (this.monthlyRun) {
        await message.reply("月次サマリーはすでに生成中です。");
        return;
      }
      const { year, month } = getJstDateParts();
      await message.reply("月次サマリーを生成中...");
      await this.runMonthlyReport(year, month);
    }
  }

  private canRunManualCommand(message: Message): boolean {
    if (message.channelId !== this.env.reportChannelId) {
      return false;
    }

    return (
      this.env.allowedUserIds.length === 0 ||
      this.env.allowedUserIds.includes(message.author.id)
    );
  }

  private scheduleNextDailyRun(): void {
    const delay = millisecondsUntilNextJst(23, 59);
    const scheduledRunAt = new Date(Date.now() + delay);
    this.dailyTimer = setTimeout(async () => {
      try {
        console.info("日報生成タスク開始");
        await this.runDailyReport(scheduledRunAt);

        if (isLastDayOfMonthJst(scheduledRunAt)) {
          const { year, month } = getJstDateParts(scheduledRunAt);
          console.info("月次サマリー生成タスク開始");
          await this.runMonthlyReport(year, month);
        }
      } catch (error) {
        console.error("スケジュール実行エラー:", error);
      } finally {
        this.scheduleNextDailyRun();
      }
    }, delay);

    console.info(`次回の自動実行まで ${Math.round(delay / 1000)} 秒`);
  }

  private async getTextChannel(channelId: string): Promise<TextChannel | null> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return null;
    }
    return channel;
  }

  private async fetchMemosForJstDate(targetDate: Date): Promise<string[]> {
    const channel = await this.getTextChannel(this.env.memoChannelId);
    if (!channel) {
      console.error(
        `雑記チャンネルが見つかりません: ${this.env.memoChannelId}`,
      );
      return [];
    }

    const { start, end } = jstDayRangeAsUtc(targetDate);
    const messages: Message[] = [];
    let before: string | undefined;

    while (true) {
      const batch = await channel.messages.fetch({ before, limit: 100 });
      if (batch.size === 0) {
        break;
      }

      const sorted = [...batch.values()].sort(
        (a, b) => b.createdTimestamp - a.createdTimestamp,
      );
      messages.push(
        ...sorted.filter(
          (message) => message.createdAt >= start && message.createdAt < end,
        ),
      );

      if (sorted.at(-1)?.createdAt && sorted.at(-1)!.createdAt < start) {
        break;
      }

      before = sorted.at(-1)?.id;
      if (!before) {
        break;
      }
    }

    const memos = messages
      .filter((message) => !message.author.bot)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(
        (message) => `[${formatJstTime(message.createdAt)}] ${message.content}`,
      )
      .filter((line) => line.trim().length > 8);

    console.info(`${formatJstDate(targetDate)} のメモ取得件数: ${memos.length}`);
    return memos;
  }

  private async fetchMonthReports(
    year: number,
    month: number,
  ): Promise<string[]> {
    const channel = await this.getTextChannel(this.env.reportChannelId);
    if (!channel) {
      console.error(
        `日報チャンネルが見つかりません: ${this.env.reportChannelId}`,
      );
      return [];
    }

    const { start, end } = monthRangeJstAsUtc(year, month);
    const reports: string[] = [];
    let before: string | undefined;

    while (true) {
      const batch = await channel.messages.fetch({ before, limit: 100 });
      if (batch.size === 0) {
        break;
      }

      const sorted = [...batch.values()].sort(
        (a, b) => b.createdTimestamp - a.createdTimestamp,
      );
      for (const message of sorted) {
        if (message.createdAt < start) {
          console.info(`${year}/${month} の日報取得件数: ${reports.length}`);
          return reports.reverse();
        }

        if (
          message.createdAt >= start &&
          message.createdAt < end &&
          message.author.id === this.client.user?.id &&
          message.content.startsWith("📋")
        ) {
          reports.push(message.content);
        }
      }

      before = sorted.at(-1)?.id;
      if (!before) {
        break;
      }
    }

    console.info(`${year}/${month} の日報取得件数: ${reports.length}`);
    return reports.reverse();
  }

  private async callClaude(system: string, user: string): Promise<string> {
    const response = await this.anthropic.messages.create({
      model: this.env.anthropicModel,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    });

    return extractClaudeText(response);
  }

  private async runDailyReport(targetDate: Date): Promise<void> {
    if (this.dailyRun) {
      return this.dailyRun;
    }

    this.dailyRun = this.generateDailyReport(targetDate).finally(() => {
      this.dailyRun = undefined;
    });
    return this.dailyRun;
  }

  private async runMonthlyReport(year: number, month: number): Promise<void> {
    if (this.monthlyRun) {
      return this.monthlyRun;
    }

    this.monthlyRun = this.generateMonthlyReport(year, month).finally(() => {
      this.monthlyRun = undefined;
    });
    return this.monthlyRun;
  }

  async generateDailyReport(targetDate = new Date()): Promise<void> {
    const reportChannel = await this.getTextChannel(this.env.reportChannelId);
    if (!reportChannel) {
      console.error("日報チャンネルが見つかりません");
      return;
    }

    const memos = await this.fetchMemosForJstDate(targetDate);
    const todayStr = formatJstDate(targetDate);

    if (memos.length === 0) {
      await reportChannel.send(
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
- 敬語不要、簡潔に
- 重複をまとめる
- 時刻は参考程度に使い、時系列の羅列にしない`;

    const userPrompt = `${todayStr}の雑記:\n\n${memos.join("\n")}`;

    try {
      const reportBody = await this.callClaude(systemPrompt, userPrompt);
      let message = `📋 **${todayStr}の日報**\n\n${reportBody}`;
      if (message.length > SAFE_DISCORD_LIMIT) {
        message = `${message.slice(0, SAFE_DISCORD_LIMIT)}\n\n...(省略)`;
      }
      await reportChannel.send(message.slice(0, DISCORD_LIMIT));
      console.info("日報を投稿しました");
    } catch (error) {
      console.error("日報生成エラー:", error);
      await reportChannel.send(
        "⚠️ 日報の生成中にエラーが発生しました。詳細はログを確認してください。",
      );
    }
  }

  async generateMonthlyReport(year: number, month: number): Promise<void> {
    const reportChannel = await this.getTextChannel(this.env.reportChannelId);
    if (!reportChannel) {
      console.error("日報チャンネルが見つかりません");
      return;
    }

    const reports = await this.fetchMonthReports(year, month);
    const monthStr = formatJstMonth(year, month);

    if (reports.length === 0) {
      await reportChannel.send(
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
- 全日報を横断して重複をまとめる
- 細かすぎる作業は統合して書く
- ポジティブかつ具体的に`;

    const combinedReports = reports.join("\n\n---\n\n").slice(0, 6000);
    const userPrompt = `${monthStr}の日報一覧:\n\n${combinedReports}`;

    try {
      const summary = await this.callClaude(systemPrompt, userPrompt);
      const message = `📊 **${monthStr}の月次振り返り**\n\n${summary}`;
      for (const chunk of splitDiscordMessage(message)) {
        await reportChannel.send(chunk);
      }
      console.info(`${monthStr}の月次サマリーを投稿しました`);
    } catch (error) {
      console.error("月次サマリー生成エラー:", error);
      await reportChannel.send(
        "⚠️ 月次サマリーの生成中にエラーが発生しました。詳細はログを確認してください。",
      );
    }
  }

  private shutdown(signal: NodeJS.Signals): void {
    console.info(`${signal} を受信したため終了します`);
    if (this.dailyTimer) {
      clearTimeout(this.dailyTimer);
    }
    this.client.destroy();
    process.exit(0);
  }
}

async function main(): Promise<void> {
  const agent = new ReportAgent(loadEnv());
  await agent.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
