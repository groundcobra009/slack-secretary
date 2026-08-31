import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/run.js";
import { loadState } from "../src/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BRAIN_DIR = path.join(__dirname, "fixtures", "brain");

async function makeTempDir() {
  return mkdtemp(path.join(tmpdir(), "slack-secretary-run-"));
}

function silentLogger() {
  const logs = [];
  return {
    log: (msg) => logs.push(["log", msg]),
    warn: (msg) => logs.push(["warn", msg]),
    error: (msg) => logs.push(["error", msg]),
    logs,
  };
}

test("run: brainディレクトリが無ければSKIPして正常終了する（Slackを一切呼ばない）", async () => {
  let slackCalled = false;
  const slackClient = {
    usersConversations: async () => {
      slackCalled = true;
      return { ok: true, channels: [] };
    },
    conversationsHistory: async () => ({ ok: true, messages: [] }),
    chatPostMessage: async () => ({ ok: true }),
  };
  const logger = silentLogger();

  const result = await run({
    env: {},
    brainDir: path.join(tmpdir(), "slack-secretary-nonexistent-brain-xyz"),
    slackClient,
    claudeClient: async () => '{"escalate": false, "reply": "呼ばれない"}',
    logger,
  });

  assert.equal(result.anyConfigured, false);
  assert.equal(result.brainFound, false);
  assert.equal(slackCalled, false);
  assert.ok(logger.logs.some(([, msg]) => msg.includes("SKIP: brain not found")));
});

test("run: secrets未設定ならSKIPして正常終了する（Slackを一切呼ばない）", async () => {
  const dir = await makeTempDir();
  const statePath = path.join(dir, "last_seen.json");
  let slackCalled = false;
  const slackClient = {
    usersConversations: async () => {
      slackCalled = true;
      return { ok: true, channels: [] };
    },
    conversationsHistory: async () => ({ ok: true, messages: [] }),
    chatPostMessage: async () => ({ ok: true }),
  };
  const logger = silentLogger();

  const result = await run({
    env: {},
    brainDir: FIXTURE_BRAIN_DIR,
    statePath,
    slackClient,
    claudeClient: async () => '{"escalate": false, "reply": "呼ばれない"}',
    logger,
  });

  assert.equal(result.anyConfigured, false);
  assert.equal(slackCalled, false);
  assert.ok(
    logger.logs.some(([, msg]) => msg.includes('SKIP: secrets not configured for workspace "test-workspace"'))
  );
  await rm(dir, { recursive: true });
});

test("run: メンション検出→返信生成→投稿→state更新まで一気通貫で動く", async () => {
  const dir = await makeTempDir();
  const statePath = path.join(dir, "last_seen.json");

  const postCalls = [];
  const slackClient = {
    usersConversations: async () => ({
      ok: true,
      channels: [{ id: "C1", name: "test-channel" }],
    }),
    conversationsHistory: async () => ({
      ok: true,
      messages: [{ ts: "100.000", user: "U_OTHER", text: "<@U_TEST> 資料どこですか" }],
    }),
    chatPostMessage: async (token, params) => {
      postCalls.push({ token, params });
      return { ok: true, ts: "999.000" };
    },
  };

  const env = {
    SLACK_BOT_TOKEN_TEST: "xoxb-test",
    SLACK_USER_TOKEN_TEST: "xoxp-test",
    SLACK_USER_ID_TEST: "U_TEST",
  };

  const logger = silentLogger();
  const result = await run({
    env,
    brainDir: FIXTURE_BRAIN_DIR,
    statePath,
    slackClient,
    claudeClient: async () => '{"escalate": false, "reply": "Drive内の共有フォルダにあります"}',
    logger,
  });

  assert.equal(result.anyConfigured, true);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].token, "xoxb-test");
  assert.equal(postCalls[0].params.channel, "C1");
  assert.match(postCalls[0].params.text, /Drive内の共有フォルダにあります/);
  assert.match(postCalls[0].params.text, /けいたろうの秘書AI/);

  const savedState = await loadState(statePath);
  assert.equal(savedState["test-workspace"].C1, "100.000");

  // ログ衛生: 本文・チャンネル名がそのままログに出ていないこと
  const allLogs = logger.logs.map(([, msg]) => msg).join("\n");
  assert.ok(!allLogs.includes("Drive内の共有フォルダにあります"));
  assert.ok(!allLogs.includes("test-channel"));
  assert.ok(logger.logs.some(([, msg]) => msg.includes("posted (workspace=test-workspace")));

  await rm(dir, { recursive: true });
});

test("run: allowlist外チャンネルは投稿をスキップしつつ処理済みにする", async () => {
  const dir = await makeTempDir();
  const statePath = path.join(dir, "last_seen.json");

  let postCalled = false;
  const slackClient = {
    usersConversations: async () => ({
      ok: true,
      channels: [{ id: "C2", name: "other-channel" }],
    }),
    conversationsHistory: async () => ({
      ok: true,
      messages: [{ ts: "100.000", user: "U_OTHER", text: "<@U_TEST> こっそり聞きたい" }],
    }),
    chatPostMessage: async () => {
      postCalled = true;
      return { ok: true };
    },
  };

  const env = {
    SLACK_BOT_TOKEN_TEST: "xoxb-test",
    SLACK_USER_TOKEN_TEST: "xoxp-test",
    SLACK_USER_ID_TEST: "U_TEST",
  };

  const logger = silentLogger();
  await run({
    env,
    brainDir: FIXTURE_BRAIN_DIR,
    statePath,
    slackClient,
    claudeClient: async () => '{"escalate": false, "reply": "回答"}',
    logger,
  });

  assert.equal(postCalled, false);
  assert.ok(logger.logs.some(([level, msg]) => level === "warn" && msg.includes("skipped: not allowlisted")));

  const savedState = await loadState(statePath);
  assert.equal(savedState["test-workspace"].C2, "100.000", "allowlist外でも処理済みとしてstateは更新される");

  const allLogs = logger.logs.map(([, msg]) => msg).join("\n");
  assert.ok(!allLogs.includes("other-channel"));
  assert.ok(!allLogs.includes("こっそり聞きたい"));

  await rm(dir, { recursive: true });
});

test("run: 返信生成が失敗したイベントはstateを更新しない（次回リトライ）", async () => {
  const dir = await makeTempDir();
  const statePath = path.join(dir, "last_seen.json");

  const slackClient = {
    usersConversations: async () => ({
      ok: true,
      channels: [{ id: "C1", name: "test-channel" }],
    }),
    conversationsHistory: async () => ({
      ok: true,
      messages: [{ ts: "100.000", user: "U_OTHER", text: "<@U_TEST> 質問です" }],
    }),
    chatPostMessage: async () => ({ ok: true }),
  };

  const env = {
    SLACK_BOT_TOKEN_TEST: "xoxb-test",
    SLACK_USER_TOKEN_TEST: "xoxp-test",
    SLACK_USER_ID_TEST: "U_TEST",
  };

  const logger = silentLogger();
  await run({
    env,
    brainDir: FIXTURE_BRAIN_DIR,
    statePath,
    slackClient,
    claudeClient: async () => {
      throw new Error("claude呼び出し失敗（模擬・機密文字列を含まない）");
    },
    logger,
  });

  const savedState = await loadState(statePath);
  assert.equal(savedState["test-workspace"]?.C1, undefined, "失敗したイベントのstateは更新されない");
  assert.ok(logger.logs.some(([level, msg]) => level === "error" && msg.includes("failed: reply processing error")));

  const allLogs = logger.logs.map(([, msg]) => msg).join("\n");
  assert.ok(!allLogs.includes("質問です"));

  await rm(dir, { recursive: true });
});
