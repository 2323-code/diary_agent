import "dotenv/config";

const commands = [
  {
    name: "daily_report",
    description: "今日分の日報を生成します",
  },
  {
    name: "daily_report_yesterday",
    description: "昨日分の日報を生成します",
  },
  {
    name: "monthly_report",
    description: "今月分の月次サマリーを生成します",
  },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が設定されていません`);
  }
  return value;
}

async function main(): Promise<void> {
  const token = requireEnv("DISCORD_BOT_TOKEN");
  const applicationId = requireEnv("DISCORD_APPLICATION_ID");
  const guildId = process.env.DISCORD_GUILD_ID;

  const route = guildId
    ? `/applications/${applicationId}/guilds/${guildId}/commands`
    : `/applications/${applicationId}/commands`;

  const response = await fetch(`https://discord.com/api/v10${route}`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(
      `Discord command registration failed: ${response.status} ${await response.text()}`,
    );
  }

  console.info(
    guildId
      ? `Registered ${commands.length} guild commands for ${guildId}`
      : `Registered ${commands.length} global commands`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
