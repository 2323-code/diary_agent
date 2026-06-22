export type RequiredEnv = {
  discordBotToken: string;
  anthropicApiKey: string;
  memoChannelId: string;
  reportChannelId: string;
  anthropicModel: string;
  allowedUserIds: string[];
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が設定されていません`);
  }
  return value;
}

export function parseCsvEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadEnv(): RequiredEnv {
  return {
    discordBotToken: requireEnv("DISCORD_BOT_TOKEN"),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    memoChannelId: requireEnv("DISCORD_MEMO_CHANNEL_ID"),
    reportChannelId: requireEnv("DISCORD_REPORT_CHANNEL_ID"),
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    allowedUserIds: parseCsvEnv(process.env.DISCORD_ALLOWED_USER_IDS),
  };
}
