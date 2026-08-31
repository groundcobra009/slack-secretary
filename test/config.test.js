import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateConfig,
  loadWorkspacesConfig,
  resolveWorkspaceSecrets,
  resolveConfigPath,
  isAllowlisted,
  isExcludedChannel,
  isExcludedDmUser,
} from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BRAIN_DIR = path.join(__dirname, "fixtures", "brain");

const validWorkspace = {
  name: "main",
  botTokenEnv: "SLACK_BOT_TOKEN_MAIN",
  userTokenEnv: "SLACK_USER_TOKEN_MAIN",
  userIdEnv: "SLACK_USER_ID_MAIN",
  replyAllowlist: ["general"],
  readExclude: { channels: ["C_SECRET"], dmUsers: ["U_SECRET"] },
};

test("validateConfig: 正しい設定は通る", () => {
  const result = validateConfig([validWorkspace]);
  assert.equal(result.length, 1);
});

test("validateConfig: 配列でなければ例外", () => {
  assert.throws(() => validateConfig({}), /配列/);
});

test("validateConfig: 空配列は例外", () => {
  assert.throws(() => validateConfig([]), /少なくとも1つ/);
});

test("validateConfig: 必須フィールド欠落は例外", () => {
  const bad = { ...validWorkspace, name: "" };
  assert.throws(() => validateConfig([bad]));
});

test("validateConfig: 名前重複は例外", () => {
  assert.throws(() => validateConfig([validWorkspace, validWorkspace]), /重複/);
});

test("resolveConfigPath: brainベースディレクトリからconfig/workspaces.jsonのパスを組み立てる", () => {
  assert.equal(
    resolveConfigPath("/tmp/brain"),
    path.join("/tmp/brain", "config", "workspaces.json")
  );
});

test("loadWorkspacesConfig: fixtureのconfig/workspaces.jsonが読める", async () => {
  const workspaces = await loadWorkspacesConfig(resolveConfigPath(FIXTURE_BRAIN_DIR));
  assert.ok(workspaces.length >= 1);
  assert.equal(workspaces[0].name, "test-workspace");
});

test("resolveWorkspaceSecrets: env変数名からトークンを解決する", () => {
  const env = {
    SLACK_BOT_TOKEN_MAIN: "xoxb-test",
    SLACK_USER_TOKEN_MAIN: "xoxp-test",
    SLACK_USER_ID_MAIN: "U123",
  };
  const secrets = resolveWorkspaceSecrets(validWorkspace, env);
  assert.deepEqual(secrets, { botToken: "xoxb-test", userToken: "xoxp-test", userId: "U123" });
});

test("resolveWorkspaceSecrets: envが無ければundefined", () => {
  const secrets = resolveWorkspaceSecrets(validWorkspace, {});
  assert.equal(secrets.botToken, undefined);
});

test("isAllowlisted: allowlist内はtrue、外はfalse", () => {
  assert.equal(isAllowlisted(validWorkspace, "general"), true);
  assert.equal(isAllowlisted(validWorkspace, "random"), false);
});

test("isExcludedChannel / isExcludedDmUser: 除外リストを尊重する", () => {
  assert.equal(isExcludedChannel(validWorkspace, "C_SECRET"), true);
  assert.equal(isExcludedChannel(validWorkspace, "C_OTHER"), false);
  assert.equal(isExcludedDmUser(validWorkspace, "U_SECRET"), true);
  assert.equal(isExcludedDmUser(validWorkspace, "U_OTHER"), false);
});
