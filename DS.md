# DS（設計仕様書）— Slack常駐AI秘書（けいたろう秘書）Phase 1

`GOAL.md` は本リポジトリでは未作成（Issue駆動開発の要件正本はGitHub Issue #1）。
ここは要件と仕様に絞る。詳細な経緯・議論はIssue #1のコメント（知見ログ）を参照。

## 要件

- けいたろう本人が参加している全チャンネルを横断的に読み取り、本人宛てメンション（`<@USER_ID>`）を検出できる
- 検出したメンションに対し、persona（人格・判断基準）とスレッド文脈・カレンダー情報を踏まえた一次応答を生成できる
- 生成した返信は必ず固定注記を末尾に付与する
- 金額・日程確定・契約・約束・機密に関わる内容はエスカレーション判定し、本人確認の定型文に差し替える
- 投稿は `replyAllowlist` に列挙したチャンネルのみに制限し、それ以外は物理的に拒否する
- 一度処理したメッセージは再処理しない（state管理）
- Secrets未設定でもワークフローが失敗せずSKIPする
- 全テストはトークン・ネットワーク不要（モック）で実行できる

## 仕様

### 読み取り（scan.js）

- xoxpトークンで `users.conversations`（`public_channel,private_channel,mpim,im`）を叩き、参加チャンネルを列挙
- 各チャンネルで `conversations.history` を取得し、`readExclude.channels` / `readExclude.dmUsers` に該当するものは読み取り自体をスキップ
- メッセージは `<@USER_ID>` を含み、かつ①本人自身の発言でない ②bot発言（`bot_id` または `subtype: bot_message`）でない ③ `lastSeen` のtsより新しい、の3条件を満たすものだけを未処理メンションとして返す
- Slackの応答は新しい順のため、処理順序を安定させるため古い順に並べ替える

### カレンダー（calendar.js）

- ICSテキストの `BEGIN:VEVENT`〜`END:VEVENT` を最小パースし、`SUMMARY` / `DTSTART` / `DTEND` を抽出
- タイムゾーンは `TZID`（Intlの標準タイムゾーンDBで変換）と `Z`（UTC）のみ対応。floating time（どちらも無い）はUTC扱いにフォールバック（既知の制約）
- 終日イベント（`VALUE=DATE`）に対応
- `formatUpcomingEvents` で「今後N日間の予定」を日本語テキストに整形する

### 返信生成（reply.js）

- persona（`persona/core.md` / `judgment.md` / `disclaimer.md`）・スレッド文脈・カレンダー要約からプロンプトを組み立てる
- キーワード判定（一段目・機械的）でエスカレーション対象語（金額・契約・確定等）を検出した場合は `claude -p` を呼ばずに定型文へ差し替える
- キーワードに掛からない場合は `claude -p` を呼び、`{"escalate": boolean, "reply": string}` 形式のJSON出力を期待する。JSONでない・パース不能な場合は素の文字列を返信文として扱う（フォールバック）
- 返信本文には必ず `persona/disclaimer.md` から抽出した固定注記を末尾に付与する

### 投稿（post.js）

- `replyAllowlist` に含まれないチャンネル名への投稿は `NotAllowlistedError` を投げて物理的に拒否する
- 許可されたチャンネルにはbotトークン（xoxb）で `chat.postMessage`（`thread_ts` 指定でスレッド返信）する

### state管理（state.js / run.js）

- `state/last_seen.json` は `{ "<workspaceName>": { "<channelId>": "<ts>" } }` 形式
- 正常に投稿できた、またはallowlist外で意図的にスキップしたイベントは処理済みとしてstateを更新する
- 返信生成・投稿でその他の予期しないエラーが起きたイベントはstateを更新せず、次回実行でリトライする

### オーケストレーション（run.js）

- ワークスペースごとに `botTokenEnv` / `userTokenEnv` / `userIdEnv` の環境変数を解決し、いずれか欠けていればそのワークスペースをSKIPする
- 全ワークスペースがSKIPだった場合は `SKIP: secrets not configured` を出して正常終了する（exit 0）
- `GCAL_ICS_URL` が未設定の場合はカレンダー要約なしで返信生成する（クラッシュしない）

## 技術前提

- Node.js 20+・ESM（`"type": "module"`）
- ランタイム依存ゼロ（`fetch` / `node:test` / `node:child_process` / `node:fs` など標準のみ）
- テスト: `node --test test/**/*.test.js`（`npm test`）。すべて外部呼び出しをモックで注入
- 実行環境: GitHub Actions（`ubuntu-latest`・Node 20）。ローカル実行も `node src/run.js` で可能

## 成果物

- `src/` 一式（config.js / slack.js / scan.js / calendar.js / reply.js / post.js / state.js / run.js）
- `config/workspaces.json`・`persona/*.md`・`state/last_seen.json`
- `.github/workflows/{ci.yml,secretary.yml}`
- `test/` 一式（node:test）
- `README.md`・`DS.md`・`DECISIONS.md`・`CHANGELOG.md`
