import { test } from "node:test";
import assert from "node:assert/strict";
import { postReply, NotAllowlistedError } from "../src/post.js";

const workspace = {
  name: "main",
  replyAllowlist: ["general"],
  readExclude: { channels: [], dmUsers: [] },
};

test("postReply: allowlist内チャンネルには投稿できる", async () => {
  const calls = [];
  const slackClient = {
    chatPostMessage: async (token, params) => {
      calls.push({ token, params });
      return { ok: true, ts: "999.000" };
    },
  };
  const res = await postReply({
    slackClient,
    botToken: "xoxb-token",
    workspace,
    channelId: "C1",
    channelName: "general",
    threadTs: "111.111",
    text: "承知しました",
  });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, "xoxb-token");
  assert.equal(calls[0].params.channel, "C1");
  assert.equal(calls[0].params.thread_ts, "111.111");
  assert.equal(calls[0].params.text, "承知しました");
});

test("postReply: allowlist外チャンネルへの投稿は拒否される（Slackを呼ばない）", async () => {
  let called = false;
  const slackClient = {
    chatPostMessage: async () => {
      called = true;
      return { ok: true };
    },
  };
  await assert.rejects(
    () =>
      postReply({
        slackClient,
        botToken: "xoxb-token",
        workspace,
        channelId: "C2",
        channelName: "random",
        threadTs: "111.111",
        text: "承知しました",
      }),
    NotAllowlistedError
  );
  assert.equal(called, false);
});
