import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadState, saveState, getLastSeen, updateLastSeen } from "../src/state.js";

test("loadState: 存在しないファイルは空オブジェクト", async () => {
  const state = await loadState("/nonexistent/path/last_seen.json");
  assert.deepEqual(state, {});
});

test("saveState → loadState: 書いて読み返せる", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "slack-secretary-state-"));
  const statePath = path.join(dir, "last_seen.json");
  await saveState({ main: { C1: "111.000" } }, statePath);
  const loaded = await loadState(statePath);
  assert.deepEqual(loaded, { main: { C1: "111.000" } });
  await rm(dir, { recursive: true });
});

test("getLastSeen: ワークスペース・チャンネル別に取得できる", () => {
  const state = { main: { C1: "100.000" } };
  assert.equal(getLastSeen(state, "main", "C1"), "100.000");
  assert.equal(getLastSeen(state, "main", "C2"), undefined);
  assert.equal(getLastSeen(state, "other", "C1"), undefined);
});

test("updateLastSeen: 新しいtsで更新される（イミュータブル）", () => {
  const state = { main: { C1: "100.000" } };
  const next = updateLastSeen(state, "main", "C1", "200.000");
  assert.equal(getLastSeen(next, "main", "C1"), "200.000");
  assert.equal(getLastSeen(state, "main", "C1"), "100.000", "元のstateは変更されない");
});

test("updateLastSeen: 古いtsでは更新されない", () => {
  const state = { main: { C1: "200.000" } };
  const next = updateLastSeen(state, "main", "C1", "100.000");
  assert.equal(getLastSeen(next, "main", "C1"), "200.000");
});

test("updateLastSeen: 未登録チャンネルは新規追加される", () => {
  const state = {};
  const next = updateLastSeen(state, "main", "C1", "100.000");
  assert.equal(getLastSeen(next, "main", "C1"), "100.000");
});
