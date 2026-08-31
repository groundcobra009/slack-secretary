# Slack常駐AI秘書（けいたろう秘書）

- エリアID: slack-secretary
- 開始日: 2026-08-31
- 指揮・記録: ai-company（ポインタ: company/areas/slack-secretary.md）
- 要件の正本: GitHub Issue [#1](https://github.com/groundcobra009/slack-secretary/issues/1)

Slackでけいたろう本人宛てに来たメンションに、秘書AI「けいたろう秘書」が一次応答するbot（Phase 1・MVP）。
GitHub Actionsが5分おきに全参加チャンネルを徘徊読み取りし、本人宛てメンションを見つけたら
`claude -p` で返信を生成、allowlistチャンネルにのみスレッド返信で投稿する。

## アーキテクチャ

- Node.js 20+・ESM・**ランタイム依存ゼロ**（`fetch` / `node:test` など標準のみ）
- 読み＝ユーザートークン（xoxp）／書き＝botトークン（xoxb）の2本立て（DECISIONSのDEC-001参照）
- 外部呼び出し（Slack API・ICS取得・`claude -p`）はすべて薄い注入可能レイヤー（`src/slack.js` / `src/reply.js` / `src/run.js`）
- state（`state/last_seen.json`）はチャンネルごとの最終処理tsのみを保持。生の会話ログはコミットしない

```
src/config.js   config/workspaces.json のロード・バリデーション
src/slack.js    Slack Web APIの薄いラッパ
src/scan.js     徘徊読み取り（本人宛てメンション検出）
src/calendar.js ICS最小パーサ・直近予定の整形
src/reply.js    返信生成（persona合成・claude -p 呼び出し・エスカレーション判定）
src/post.js     投稿（allowlistガード）
src/state.js    last_seen.json の読み書き
src/run.js      オーケストレーター
```

## セットアップ手順（けいたろうさんの手作業）

このリポジトリのコードはSecretsが無くても `npm test` は通り、Actions実行もSKIPして正常終了する。
実際にSlackで動かすには、以下をけいたろうさんの手で行う必要がある。

### ① Claude Code の OAuth トークン発行

```bash
claude setup-token
```

発行された値を GitHub Secrets `CLAUDE_CODE_OAUTH_TOKEN` に登録する。

### ② Slackアプリの作成（bot用 xoxb ＋ ユーザー用 xoxp）

1. https://api.slack.com/apps で新規アプリを作成
2. **Bot Token Scopes**（xoxb）: `chat:write`
3. **User Token Scopes**（xoxp）: `channels:history` `groups:history` `im:history` `mpim:history` `channels:read` `groups:read` `users:read`
4. ワークスペースにインストールし、Bot User OAuth Token（`xoxb-...`）と User OAuth Token（`xoxp-...`）を控える
5. けいたろう本人のSlackユーザーID（`U...`）を控える（プロフィール→その他→メンバーIDをコピー）
6. **投稿してほしいチャンネルにbotを招待する**（`/invite @けいたろう秘書` 等）。招待していないチャンネルには投稿できない

### ③ 個人カレンダーのICS限定公開URLを取得

1. Googleカレンダーの設定 → 対象カレンダー →「限定公開URL」をコピー（`https://calendar.google.com/calendar/ical/.../private-xxxx/basic.ics`）
2. このURLは知っている人なら誰でも予定を読めるため、Secrets以外の場所（Slack投稿・コミット等）に貼らない

### ④ GitHub Secrets へ登録

対象リポジトリの Settings → Secrets and variables → Actions に以下を登録する。

| Secret名 | 用途 |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude -p` の非対話認証 |
| `SLACK_BOT_TOKEN_MAIN` | 投稿用（xoxb） |
| `SLACK_USER_TOKEN_MAIN` | 読み取り用（xoxp） |
| `SLACK_USER_ID_MAIN` | 本人のSlackユーザーID |
| `GCAL_ICS_URL` | 個人カレンダーのICS限定公開URL |

`config/workspaces.json` の `botTokenEnv` / `userTokenEnv` / `userIdEnv` がこれらのSecret名と対応している。
複数ワークスペースに広げる場合は、この設定ファイルに要素を追加し、対応するSecretを増やす（Phase 2）。

### `config/workspaces.json` の設定項目

- `replyAllowlist`: 投稿してよいチャンネル名の配列（**書きは狭く**）
- `readExclude.channels` / `readExclude.dmUsers`: 読み取り対象から除外するチャンネルID・DM相手のユーザーID

## ローカル動作確認

```bash
npm install
npm test
```

トークンが無くても全テストが通る（Slack API・claude CLIはすべてモック）。

## 実機E2E確認手順（Secrets登録後）

1. GitHub Actions の `secretary` workflow を `workflow_dispatch` で手動実行する（初回確認用。定常運用は5分cron）
2. allowlist対象チャンネル（既定: `general`）で、けいたろう本人宛てに `<@本人のユーザーID>` を含むメッセージを投稿する
3. **5〜15分以内**に、スレッド内で「（※これはけいたろうの秘書AIによる一次応答です。正式な回答は、追って本人からあらためてお送りします）」の注記が末尾に付いた返信が来ることを確認する
4. 「◯◯万円で契約お願いします」のような金額・契約系メッセージを送り、エスカレーション定型文（「本人に確認して戻します」）に切り替わることを確認する
5. allowlist外のチャンネルでメンションしても投稿されない（Actionsログに `SKIP投稿` が出る）ことを確認する
6. `state/last_seen.json` がActionsによって自動コミットされ、同じメッセージに二重返信しないことを確認する

## 安全ルール

- 「読みは広く、書きは狭く」: 投稿は必ず `replyAllowlist` 内のみ。読み取りは `readExclude` を尊重する
- 生の会話ログをリポジトリにコミットしない（stateはタイムスタンプのみ）
- トークンを一切ハードコード・コミットしない（すべてGitHub Secrets経由）
- ファイル削除は行わない（`rm` を使わない）

## Phase 1でやらないこと

- 実トークンの発行・Secrets登録の実作業（本READMEの手順に従いけいたろうさんが行う）
- 複数ワークスペースの実運用・Notion参照・週報蓄積・即時リレー（Phase 2）
- 業務カレンダー・他者管理ワークスペース（Phase 3）
