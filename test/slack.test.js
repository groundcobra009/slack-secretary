import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlackClient } from "../src/slack.js";

function fakeFetch(responseData) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      json: async () => responseData,
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("slack client: 正常応答を返す・トークンをAuthorizationヘッダに載せる", async () => {
  const fetchImpl = fakeFetch({ ok: true, channels: [] });
  const client = createSlackClient({ fetchImpl });
  const res = await client.usersConversations("xoxp-token", { types: "public_channel" });
  assert.equal(res.ok, true);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, "https://slack.com/api/users.conversations");
  assert.equal(fetchImpl.calls[0].opts.headers.Authorization, "Bearer xoxp-token");
});

test("slack client: ok:false は例外を投げる（ネットワーク不要でエラーハンドリングを検証）", async () => {
  const fetchImpl = fakeFetch({ ok: false, error: "invalid_auth" });
  const client = createSlackClient({ fetchImpl });
  await assert.rejects(
    () => client.conversationsHistory("xoxp-bad", { channel: "C1" }),
    /invalid_auth/
  );
});

test("slack client: chat.postMessageはthread_tsを含めて送る", async () => {
  const fetchImpl = fakeFetch({ ok: true, ts: "123.456" });
  const client = createSlackClient({ fetchImpl });
  await client.chatPostMessage("xoxb-token", {
    channel: "C1",
    text: "hello",
    thread_ts: "111.111",
  });
  const body = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(body.thread_ts, "111.111");
  assert.equal(body.channel, "C1");
});
