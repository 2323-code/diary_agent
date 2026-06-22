# Discord Daily Report Agent

Discordの雑記チャンネル（times）を読んで、Claude APIで日報・月次振り返りを自動生成するBotです。

## できること

- **毎日 23:59 JST** に雑記チャンネルのメッセージを取得し、日報を生成して日報チャンネルに投稿
- **月末 23:59 JST** にその月の日報をまとめて月次サマリーを投稿
- `!daily_report` / `!daily_report_yesterday` / `!monthly_report` で手動実行

## セットアップ

### 1. Discord Bot を作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) を開く
2. **New Application** → 名前をつけて作成
3. **Bot** タブ → **Add Bot**
4. **Token** をコピー
5. **Privileged Gateway Intents** で `MESSAGE CONTENT INTENT` を有効化
6. **OAuth2 → URL Generator** でBotをサーバーに招待
   - Scopes: `bot`
   - Bot Permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`

### 2. チャンネルIDを取得する

Discordの設定で **開発者モード** を有効にする（設定 → 詳細設定 → 開発者モード）。

チャンネルを右クリック → **IDをコピー** で取得。

### 3. 環境変数を設定する

```bash
cp .env.example .env
```

`.env` を編集：

```env
DISCORD_BOT_TOKEN=取得したBotトークン
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

### 5. 起動する

```bash
npm start
```

`.env` は `dotenv` で自動的に読み込まれます。

## 常駐起動について

このリポジトリでは systemd による永続化手順は提供しません。必要なときだけ手元やサーバー上で `npm start` してください。

簡易的にセッションを残したい場合は `tmux` などを使えます。

```bash
tmux new -s discord-agent
npm start
# Ctrl+B → D でデタッチ
```

## 開発

```bash
npm run typecheck
npm test
npm run build
```

## ローカルで動作確認する

`.env` に実際の値を入れてから起動します。

```bash
npm start
```

特定ユーザーだけ手動実行できるか確認する場合は、`.env` の `DISCORD_ALLOWED_USER_IDS` に自分のDiscordユーザーIDだけを設定してください。

```env
DISCORD_ALLOWED_USER_IDS=123456789012345678
```

Botが起動したら、`DISCORD_REPORT_CHANNEL_ID` に設定したチャンネルで次を送信します。

```text
!daily_report_yesterday
```

昨日分の雑記チャンネル発言をもとに日報が投稿されれば成功です。許可していない別ユーザー、または日報チャンネル以外から同じコマンドを送ると拒否メッセージになります。

## ファイル構成

```text
discord-agent/
├── src/
│   ├── agent.ts          # Discord / Claude / スケジューラの統合
│   └── lib/              # 日付計算・設定・Discord文字数処理などの純粋ロジック
├── tests/                # 外部APIなしで動く単体テスト
├── package.json          # npm scripts / dependencies
├── tsconfig.json         # TypeScript設定
├── .env.example          # 環境変数テンプレート
└── README.md
```

## カスタマイズ

### 実行時刻を変更する

[src/agent.ts](src/agent.ts) の `scheduleNextDailyRun()` 内で呼んでいる `millisecondsUntilNextJst(23, 59)` を変更してください。

### Claudeモデルを変更する

`.env` の `ANTHROPIC_MODEL` を変更してください。

### 日報フォーマットを変更する

[src/agent.ts](src/agent.ts) の `generateDailyReport()` 内にある `systemPrompt` を編集してください。
