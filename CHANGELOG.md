# CHANGELOG — Slack常駐AI秘書（けいたろう秘書）

確定した変更の履歴。**マージされた変更だけ**を新しい順に記録する。
議論・試行錯誤の経緯はIssueに書く（記録の使い分けは ai-company の CLAUDE.md §4.6）。

記録項目: 日付／バージョンまたはIssue番号／変更対象／変更内容／変更理由／影響範囲

---

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
