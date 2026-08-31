// ログ衛生の担保テスト: run.js の主要フロー（モック注入）を実走させ、
// キャプチャした全ログ出力に「返信文・メッセージ本文・チャンネル名・ユーザー名・ユーザーID」が
// 含まれないことをassertする。Actionsログは全公開になる前提のため、これは回帰させてはいけない。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/run.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BRAIN_DIR = path.join(__dirname, "fixtures", "brain");

// 実際の会話に出てくる可能性のある「出してはいけない文字列」の一覧（fixtureのダミーデータ由来）
const FORBIDDEN_STRINGS = [
  "test-channel", // チャンネル名
  "other-channel", // チャンネル名（allowlist外）
  "U_OTHER", // 発言者ユーザーID
  "U_TEST", // 本人ユーザーID
  "資料はDrive内の機密フォルダにあります", // 返信本文
  "明日の進捗を教えてください", // メッセージ本文（失敗リトライ系）
  "こっそり教えてほしいのですが", // メッセージ本文（allowlist外）
];

function capturingLogger() {
  const logs = [];
  return {
    log: (msg) => logs.push(String(msg)),
    warn: (msg) => logs.push(String(msg)),
    error: (msg) => logs.push(String(msg)),
    all: () => logs.join("\n"),
  };
}

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "slack-secretary-loghygiene-"));
}

test("log-hygiene: 通常投稿・allowlist外スキップ・失敗リトライの全フローでログに本文・チャンネル名・ユーザーIDが出ない", async () => {
  const dir = await makeTempDir();
  const statePath = path.join(dir, "last_seen.json");
  const logger = capturingLogger();

  const slackClient = {
    usersConversations: async () => ({
      ok: true,
      channels: [
        { id: "C1", name: "test-channel" },
        { id: "C2", name: "other-channel" },
      ],
    }),
    conversationsHistory: async (token, params) => {
      if (params.channel === "C1") {
        return {
          ok: true,
          messages: [
            { ts: "100.000", user: "U_OTHER", text: "<@U_TEST> 資料はDrive内の機密フォルダにあります" },
            { ts: "200.000", user: "U_OTHER", text: "<@U_TEST> 明日の進捗を教えてください" },
          ],
        };
      }
      if (params.channel === "C2") {
        return {
          ok: true,
          messages: [{ ts: "300.000", user: "U_OTHER", text: "<@U_TEST> こっそり教えてほしいのですが" }],
        };
      }
      return { ok: true, messages: [] };
    },
    chatPostMessage: async () => ({ ok: true, ts: "999.000" }),
  };

  let callCount = 0;
  const claudeClient = async () => {
    callCount += 1;
    if (callCount === 2) {
      // 2回目（C1の2件目）だけ失敗させ、失敗リトライ系のログも検証する
      throw new Error("claude呼び出し失敗（模擬）");
    }
    return '{"escalate": false, "reply": "資料はDrive内の機密フォルダにあります"}';
  };

  const env = {
    SLACK_BOT_TOKEN_TEST: "xoxb-test",
    SLACK_USER_TOKEN_TEST: "xoxp-test",
    SLACK_USER_ID_TEST: "U_TEST",
  };

  await run({
    env,
    brainDir: FIXTURE_BRAIN_DIR,
    statePath,
    slackClient,
    claudeClient,
    logger,
  });

  const allLogs = logger.all();
  for (const forbidden of FORBIDDEN_STRINGS) {
    assert.ok(!allLogs.includes(forbidden), `ログに禁止文字列が含まれています: ${forbidden}`);
  }

  // 許可される情報（処理結果ラベル・ワークスペース名）は出ていることも確認する
  assert.match(allLogs, /posted \(workspace=test-workspace/);
  assert.match(allLogs, /failed: reply processing error \(workspace=test-workspace/);
  assert.match(allLogs, /skipped: not allowlisted \(workspace=test-workspace/);

  await rm(dir, { recursive: true });
});
