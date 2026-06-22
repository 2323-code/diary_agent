# Discord Daily Report Agent

Discordの雑記チャンネル（times）を読んで、Claude APIで日報・月次振り返りを自動生成する Cloudflare Workers アプリです。

## できること

- **毎日 23:59 JST** に Cloudflare Workers Cron Triggers から日報を生成
- **月末 23:59 JST** に同じ Cron から月次サマリーも生成
- Discord Slash Command で手動実行
  - `/daily_report`
  - `/daily_report_yesterday`
  - `/monthly_report`

## 仕組み

Workers では Discord Gateway に常時接続しません。

- 定時実行: `wrangler.jsonc` の Cron `59 14 * * *`（UTC 14:59 = JST 23:59）
- 手動実行: Discord Interactions Endpoint `POST /discord/interactions`
- 投稿・履歴取得: Discord REST API
- 日報生成: Anthropic Messages API

## セットアップ

### 1. Discord Application を用意する

1. [Discord Developer Portal](https://discord.com/developers/applications) を開く
2. **New Application** → 名前をつけて作成
3. **General Information** から以下を控える
   - `APPLICATION ID`
   - `PUBLIC KEY`
4. **Bot** タブ → **Add Bot**
5. Bot Token を控える
6. **OAuth2 → URL Generator** でBotをサーバーに招待
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`

### 2. チャンネルIDを取得する

Discordの設定で **開発者モード** を有効にします。

チャンネルを右クリック → **IDをコピー** で次を取得してください。

- 雑記チャンネル: `DISCORD_MEMO_CHANNEL_ID`
- 日報チャンネル: `DISCORD_REPORT_CHANNEL_ID`

### 3. ローカル環境変数を設定する

```bash
cp .env.example .env
```

`.env` を編集します。

```env
DISCORD_BOT_TOKEN=取得したBotトークン
DISCORD_APPLICATION_ID=Discord Application ID
DISCORD_PUBLIC_KEY=Discord Public Key
DISCORD_GUILD_ID=開発中だけ使うサーバーID（任意）
ANTHROPIC_API_KEY=AnthropicのAPIキー
ANTHROPIC_MODEL=claude-sonnet-4-6
DISCORD_MEMO_CHANNEL_ID=雑記チャンネルのID
DISCORD_REPORT_CHANNEL_ID=日報チャンネルのID
DISCORD_ALLOWED_USER_IDS=手動コマンドを許可するユーザーID（任意、カンマ区切り）
```

### 4. 依存パッケージをインストールする

```bash
npm install
```

## 開発

```bash
npm run typecheck
npm test
npm run build
```

Workers をローカルで起動する場合:

```bash
npm run dev
```

## デプロイ手順

以下は確認用の手順です。実行してよければ、そのタイミングでこちらから進めます。

### 1. Cloudflare にログイン

```bash
npx wrangler login
```

### 2. Workers secrets を登録

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put DISCORD_MEMO_CHANNEL_ID
npx wrangler secret put DISCORD_REPORT_CHANNEL_ID
```

任意で、手動実行できるDiscordユーザーを制限する場合:

```bash
npx wrangler secret put DISCORD_ALLOWED_USER_IDS
```

`ANTHROPIC_MODEL` は `wrangler.jsonc` の `vars` に入っています。変更したい場合は `wrangler.jsonc` を編集してください。

### 3. Workers にデプロイ

```bash
npm run deploy
```

デプロイ後、出力された Workers URL を控えます。

### 4. Discord Interactions Endpoint URL を設定

Discord Developer Portal の **General Information → Interactions Endpoint URL** に次を設定します。

```text
https://<your-worker-subdomain>.workers.dev/discord/interactions
```

Discord が署名検証用の `PING` を送ります。保存できれば Workers 側の署名検証は通っています。

### 5. Slash Command を登録

開発中は `.env` の `DISCORD_GUILD_ID` にサーバーIDを入れてから登録すると、反映が速いです。

```bash
npm run register:commands
```

`DISCORD_GUILD_ID` を空にするとグローバルコマンドとして登録されます。反映に時間がかかることがあります。

### 6. 動作確認

日報チャンネルで次を実行します。

```text
/daily_report_yesterday
```

昨日分の雑記から日報が投稿されれば成功です。

Cron は `wrangler.jsonc` の `59 14 * * *` により毎日 UTC 14:59（JST 23:59）に実行されます。

## ファイル構成

```text
discord-agent/
├── src/
│   ├── worker.ts         # Cloudflare Workers の fetch / scheduled ハンドラ
│   └── lib/              # 日報生成、日付計算、Discord文字数処理
├── scripts/
│   └── register-commands.ts
├── tests/                # 外部APIなしで動く単体テスト
├── wrangler.jsonc        # Workers設定とCron
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## カスタマイズ

### 実行時刻を変更する

[wrangler.jsonc](wrangler.jsonc) の `triggers.crons` を変更してください。Cloudflare Cron は UTC で指定します。

### Claudeモデルを変更する

[wrangler.jsonc](wrangler.jsonc) の `ANTHROPIC_MODEL` を変更してください。

### 日報フォーマットを変更する

[src/lib/report.ts](src/lib/report.ts) の `generateDailyReport()` 内にある `systemPrompt` を編集してください。
