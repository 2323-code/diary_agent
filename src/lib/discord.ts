export const DISCORD_LIMIT = 2000;
export const SAFE_DISCORD_LIMIT = 1900;

export function splitDiscordMessage(message: string): string[] {
  if (message.length <= SAFE_DISCORD_LIMIT) {
    return [message];
  }

  const chunks: string[] = [];
  for (let i = 0; i < message.length; i += SAFE_DISCORD_LIMIT) {
    chunks.push(message.slice(i, i + SAFE_DISCORD_LIMIT));
  }
  return chunks;
}

export function truncateDiscordMessage(message: string): string {
  if (message.length <= DISCORD_LIMIT) {
    return message;
  }

  return message.slice(0, DISCORD_LIMIT);
}
