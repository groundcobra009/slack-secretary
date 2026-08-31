import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/run.js";
import { loadState } from "../src/state.js";
import { DEFAULT_CONFIG_PATH } from "../src/config.js";
import { DEFAULT_PERSONA_DIR } from "../src/reply.js";

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
    configPath: DEFAULT_CONFIG_PATH,
    statePath,
    personaDir: DEFAULT_PERSONA_DIR,
    slackClient,
    claudeClient: async () => '{"escalate": false, "reply": "呼ばれない"}',
    logger,
  });

  assert.equal(result.anyConfigured, false);
  assert.equal(slackCalled, false);
  assert.ok(logger.logs.some(([, msg]) => msg.includes("SKIP: secrets not configured")));
  await rm(dir, { recursive: true });
});

test("run: メンション検出→返信生成→投稿→state更新まで一気通貫で動く", async () => {
  const dir = await makeTempDir();
  const statePath = path.join(dir, "last_seen.json");
  const configPath = path.join(dir, "workspaces.json");
  await writeFile(
    configPath,
    JSON.stringify([
      {
        name: "main",
        botTokenEnv: "SLACK_BOT_TOKEN_MAIN",
        userTokenEnv: "SLACK_USER_TOKEN_MAIN",
        userIdEnv: "SLACK_USER_ID_MAIN",
        replyAllowlist: ["general"],
        readExclude: { channels: [], dmUsers: [] },
      },
    ])
  );

  const postCalls = [];
  const slackClient = {
    usersConversations: async () => ({
      ok: true,
      channels: [{ id: "C1", name: "general" }],
    }),
    conversationsHistory: async () => ({
      ok: true,
      messages: [{ ts: "100.000", user: "U_OTHER", text: "<@U_KEITARO> 資料どこですか" }],
    }),
    chatPostMessage: async (token, params) => {
      postCalls.push({ token, params });
      return { ok: true, ts: "999.000" };
    },
  };

  const env = {
    SLACK_BOT_TOKEN_MAIN: "xoxb-test",
    SLACK_USER_TOKEN_MAIN: "xoxp-test",
    SLACK_USER_ID_MAIN: "U_KEITARO",
  };

  const result = await run({
    env,
    configPath,
    statePath,
    personaDir: DEFAULT_PERSONA_DIR,
    slackClient,
    claudeClient: async () => '{"escalate": false, "reply": "Drive内の共有フォルダにあります"}',
    logger: silentLogger(),
  });

  assert.equal(result.anyConfigured, true);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].token, "xoxb-test");
  assert.equal(postCalls[0].params.channel, "C1");
  assert.match(postCalls[0].params.text, /Drive内の共有フォルダにあります/);
  assert.match(postCalls[0].params.text, /けいたろうの秘書AI/);

  const savedState = await loadState(statePath);
  assert.equal(savedState.main.C1, "100.000");

  await rm(dir, { recursive: true });
});

test("run: allowlist外チャンネルは投稿をスキップしつつ処理済みにする", async () => {
  const dir = await makeTempDir();
  const statePath = path.join(dir, "last_seen.json");
  const configPath = path.join(dir, "workspaces.json");
  await writeFile(
    configPath,
    JSON.stringify([
      {
        name: "main",
        botTokenEnv: "SLACK_BOT_TOKEN_MAIN",
        userTokenEnv: "SLACK_USER_TOKEN_MAIN",
        userIdEnv: "SLACK_USER_ID_MAIN",
        replyAllowlist: ["general"],
        readExclude: { channels: [], dmUsers: [] },
      },
    ])
  );

  let postCalled = false;
  const slackClient = {
    usersConversations: async () => ({
      ok: true,
      channels: [{ id: "C2", name: "random" }],
    }),
    conversationsHistory: async () => ({
      ok: true,
      messages: [{ ts: "100.000", user: "U_OTHER", text: "<@U_KEITARO> こっそり聞きたい" }],
    }),
    chatPostMessage: async () => {
      postCalled = true;
      return { ok: true };
    },
  };

  const env = {
    SLACK_BOT_TOKEN_MAIN: "xoxb-test",
    SLACK_USER_TOKEN_MAIN: "xoxp-test",
    SLACK_USER_ID_MAIN: "U_KEITARO",
  };

  const logger = silentLogger();
  await run({
    env,
    configPath,
    statePath,
    personaDir: DEFAULT_PERSONA_DIR,
    slackClient,
    claudeClient: async () => '{"escalate": false, "reply": "回答"}',
    logger,
  });

  assert.equal(postCalled, false);
  assert.ok(logger.logs.some(([level, msg]) => level === "warn" && msg.includes("SKIP投稿")));

  const savedState = await loadState(statePath);
  assert.equal(savedState.main.C2, "100.000", "allowlist外でも処理済みとしてstateは更新される");

  await rm(dir, { recursive: true });
});

test("run: 返信生成が失敗したイベントはstateを更新しない（次回リトライ）", async () => {
  const dir = await makeTempDir();
  const statePath = path.join(dir, "last_seen.json");
  const configPath = path.join(dir, "workspaces.json");
  await writeFile(
    configPath,
    JSON.stringify([
      {
        name: "main",
        botTokenEnv: "SLACK_BOT_TOKEN_MAIN",
        userTokenEnv: "SLACK_USER_TOKEN_MAIN",
        userIdEnv: "SLACK_USER_ID_MAIN",
        replyAllowlist: ["general"],
        readExclude: { channels: [], dmUsers: [] },
      },
    ])
  );

  const slackClient = {
    usersConversations: async () => ({
      ok: true,
      channels: [{ id: "C1", name: "general" }],
    }),
    conversationsHistory: async () => ({
      ok: true,
      messages: [{ ts: "100.000", user: "U_OTHER", text: "<@U_KEITARO> 質問です" }],
    }),
    chatPostMessage: async () => ({ ok: true }),
  };

  const env = {
    SLACK_BOT_TOKEN_MAIN: "xoxb-test",
    SLACK_USER_TOKEN_MAIN: "xoxp-test",
    SLACK_USER_ID_MAIN: "U_KEITARO",
  };

  const logger = silentLogger();
  await run({
    env,
    configPath,
    statePath,
    personaDir: DEFAULT_PERSONA_DIR,
    slackClient,
    claudeClient: async () => {
      throw new Error("claude呼び出し失敗（模擬）");
    },
    logger,
  });

  const savedState = await loadState(statePath);
  assert.equal(savedState.main?.C1, undefined, "失敗したイベントのstateは更新されない");
  assert.ok(logger.logs.some(([level, msg]) => level === "error" && msg.includes("返信処理に失敗")));

  await rm(dir, { recursive: true });
});
