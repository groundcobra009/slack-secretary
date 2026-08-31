import { test } from "node:test";
import assert from "node:assert/strict";
import { scanMentions } from "../src/scan.js";

const USER_ID = "U_KEITARO";

const workspace = {
  name: "main",
  botTokenEnv: "SLACK_BOT_TOKEN_MAIN",
  userTokenEnv: "SLACK_USER_TOKEN_MAIN",
  userIdEnv: "SLACK_USER_ID_MAIN",
  replyAllowlist: ["general"],
  readExclude: { channels: ["C_EXCLUDED"], dmUsers: ["U_EXCLUDED_DM"] },
};

function makeMockClient({ channels, historyByChannel }) {
  return {
    usersConversations: async () => ({ ok: true, channels }),
    conversationsHistory: async (_token, params) => ({
      ok: true,
      messages: historyByChannel[params.channel] ?? [],
    }),
  };
}

test("scanMentions: 本人宛てメンションを検出する", async () => {
  const client = makeMockClient({
    channels: [{ id: "C1", name: "general" }],
    historyByChannel: {
      C1: [{ ts: "100.000", user: "U_OTHER", text: `<@${USER_ID}> 資料どこですか` }],
    },
  });
  const events = await scanMentions({
    slackClient: client,
    userToken: "xoxp-token",
    userId: USER_ID,
    workspace,
    lastSeen: {},
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].channelId, "C1");
  assert.equal(events[0].ts, "100.000");
});

test("scanMentions: 自分自身の発言は除外する", async () => {
  const client = makeMockClient({
    channels: [{ id: "C1", name: "general" }],
    historyByChannel: {
      C1: [{ ts: "100.000", user: USER_ID, text: `<@${USER_ID}> セルフメンション` }],
    },
  });
  const events = await scanMentions({
    slackClient: client,
    userToken: "xoxp-token",
    userId: USER_ID,
    workspace,
    lastSeen: {},
  });
  assert.equal(events.length, 0);
});

test("scanMentions: bot発言は除外する", async () => {
  const client = makeMockClient({
    channels: [{ id: "C1", name: "general" }],
    historyByChannel: {
      C1: [
        { ts: "100.000", user: "U_BOT", bot_id: "B1", text: `<@${USER_ID}> botからの通知` },
        {
          ts: "101.000",
          user: "U_BOT2",
          subtype: "bot_message",
          text: `<@${USER_ID}> botからの通知2`,
        },
      ],
    },
  });
  const events = await scanMentions({
    slackClient: client,
    userToken: "xoxp-token",
    userId: USER_ID,
    workspace,
    lastSeen: {},
  });
  assert.equal(events.length, 0);
});

test("scanMentions: 既処理ts以下のメッセージは除外する", async () => {
  const client = makeMockClient({
    channels: [{ id: "C1", name: "general" }],
    historyByChannel: {
      C1: [
        { ts: "100.000", user: "U_OTHER", text: `<@${USER_ID}> 既読` },
        { ts: "200.000", user: "U_OTHER", text: `<@${USER_ID}> 未読` },
      ],
    },
  });
  const events = await scanMentions({
    slackClient: client,
    userToken: "xoxp-token",
    userId: USER_ID,
    workspace,
    lastSeen: { C1: "100.000" },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].ts, "200.000");
});

test("scanMentions: メンションを含まない発言は無視する", async () => {
  const client = makeMockClient({
    channels: [{ id: "C1", name: "general" }],
    historyByChannel: {
      C1: [{ ts: "100.000", user: "U_OTHER", text: "普通の発言です" }],
    },
  });
  const events = await scanMentions({
    slackClient: client,
    userToken: "xoxp-token",
    userId: USER_ID,
    workspace,
    lastSeen: {},
  });
  assert.equal(events.length, 0);
});

test("scanMentions: 除外チャンネルは読み取らない", async () => {
  const client = {
    usersConversations: async () => ({
      ok: true,
      channels: [{ id: "C_EXCLUDED", name: "secret" }],
    }),
    conversationsHistory: async () => {
      throw new Error("除外されたチャンネルの履歴を取得してはいけない");
    },
  };
  const events = await scanMentions({
    slackClient: client,
    userToken: "xoxp-token",
    userId: USER_ID,
    workspace,
    lastSeen: {},
  });
  assert.equal(events.length, 0);
});

test("scanMentions: 除外DMユーザーは読み取らない", async () => {
  const client = {
    usersConversations: async () => ({
      ok: true,
      channels: [{ id: "D1", is_im: true, user: "U_EXCLUDED_DM" }],
    }),
    conversationsHistory: async () => {
      throw new Error("除外されたDMの履歴を取得してはいけない");
    },
  };
  const events = await scanMentions({
    slackClient: client,
    userToken: "xoxp-token",
    userId: USER_ID,
    workspace,
    lastSeen: {},
  });
  assert.equal(events.length, 0);
});
