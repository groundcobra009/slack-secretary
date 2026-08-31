# CHANGELOG — Slack常駐AI秘書（けいたろう秘書）

確定した変更の履歴。**マージされた変更だけ**を新しい順に記録する。
議論・試行錯誤の経緯はIssueに書く（記録の使い分けは ai-company の CLAUDE.md §4.6）。

記録項目: 日付／バージョンまたはIssue番号／変更対象／変更内容／変更理由／影響範囲

---

## 2026-09-01 — public/private脳分離（Issue #4）

- **変更対象**: `src/` `.github/workflows/secretary.yml` `test/` `README.md` `docs/setup-guide.html` `DECISIONS.md`（`persona/` `config/` `state/` は削除・`slack-secretary-brain` リポジトリへ移設）
- **変更内容**:
  - `persona/` `config/workspaces.json` `state/last_seen.json` をprivateリポジトリ `groundcobra009/slack-secretary-brain` へ移設
  - `src/config.js` `src/state.js` `src/reply.js` を「brainベースディレクトリ」からパスを解決する方式に変更（`resolveConfigPath` / `resolveStatePath` / `resolvePersonaDir`）。`src/run.js` に `BRAIN_DIR` 環境変数（既定 `./brain`）を追加し、brain不在時は「SKIP: brain not found」で正常終了
  - ログ衛生: 返信文・メッセージ本文・チャンネル名・ユーザー名・ユーザーIDをログ出力から排除。`src/log-safe.js` でチャンネル識別子を非復元形に変換し、処理結果は posted/skipped/failed のラベルのみ出す。`test/log-hygiene.test.js` で担保
  - `secretary.yml`: `BRAIN_REPO_TOKEN`（Fine-grained PAT）でbrainリポジトリをcheckoutするステップを追加。未設定時はcheckout・実行・state pushの各ステップをスキップして正常終了。state変更のコミット・pushをbrainリポジトリ側で実行するよう変更
  - README・setup-guide.htmlに2リポジトリ構成の図解・`BRAIN_REPO_TOKEN`発行手順・Secrets一覧を追記。DECISIONSにDEC-004（public/private分離採用）・DEC-005（Google Drive案不採用）を追記
- **変更理由**: GitHub ActionsのコストをpublicリポジトリのFree枠で$0化するため（privateリポジトリの月2,000分枠を使い切り課金停止が発生したため）。実行コード（public化予定）と個人情報を含む脳（private維持）を分離する
- **影響範囲**: 実行時に `BRAIN_DIR` で参照するbrainリポジトリが必要（Secretsに`BRAIN_REPO_TOKEN`未登録の間はActionsが正常SKIPし続ける）。`npm test` はbrainリポジトリが無くても全通過する（`test/fixtures/brain/` のダミーデータで代替）

## 2026-08-31 — CI修正（Issue #1 / PR #3）

- **変更対象**: `.github/workflows/ci.yml` `.github/workflows/secretary.yml`
- **変更内容**: runnerのNodeを22に統一（`node --test` のglobはv21+が必要）。steps の `if` で参照できない `secrets` コンテキストを job env 経由に変更。claude CLIのインストール工程を追加
- **変更理由**: マージ後CIの構文エラー・実行時欠陥の解消
- **影響範囲**: CI/定期実行のみ。なおGitHub Actionsはアカウントの課金設定（payments failed / spending limit）でジョブ起動不可の状態が別途残っており、解消は社長の操作待ち

## 2026-08-31 — Phase 1（MVP）実装

- **変更対象**: リポジトリ全体（`src/` `config/` `persona/` `state/` `.github/workflows/` `test/`）
- **変更内容**: Slack常駐AI秘書「けいたろう秘書」Phase 1を実装。徘徊読み取り（xoxp）→本人宛てメンション検出→persona合成＋`claude -p`による返信生成（エスカレーション判定付き）→allowlist限定投稿（xoxb）→state更新、をGitHub Actions（5分cron・Secrets未設定時SKIP）でオーケストレーションする一連の流れを実装した
- **変更理由**: Issue #1（社長承認済みの計画書v2）に基づくPhase 1 MVPの実装
- **影響範囲**: 新規実装のみ。実トークン未登録のためActions実行はSecrets未設定でSKIPする状態（README記載の手作業完了後に有効化）

## 2026-08-31 — エリア開始

- **変更対象**: リポジトリ全体
- **変更内容**: エリアディレクトリを新設（clone-firstフロー）
- **変更理由**: Slack常駐AI秘書（けいたろう秘書） の運用開始
- **影響範囲**: なし（初期化）
