// config/workspaces.json のロードとバリデーションを担当するモジュール。
// トークンの「実値」はここでは読まない（env変数名だけを保持し、実値の解決は run.js が行う）。
// config/ の実データは brain リポジトリに置かれる（このファイル自体はどこにも実データの既定値を持たない）。

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * brainベースディレクトリから config/workspaces.json の絶対パスを組み立てる。
 * @param {string} brainDir
 */
export function resolveConfigPath(brainDir) {
  return path.join(brainDir, "config", "workspaces.json");
}

/**
 * 1ワークスペース分の設定をバリデーションする。
 * 不正な場合は Error を投げる。
 * @param {unknown} ws
 * @param {number} index
 */
function validateWorkspace(ws, index) {
  const prefix = `workspaces[${index}]`;
  if (typeof ws !== "object" || ws === null) {
    throw new Error(`${prefix}: オブジェクトである必要があります`);
  }
  const requiredStringFields = ["name", "botTokenEnv", "userTokenEnv", "userIdEnv"];
  for (const field of requiredStringFields) {
    if (typeof ws[field] !== "string" || ws[field].length === 0) {
      throw new Error(`${prefix}.${field}: 空でない文字列が必要です`);
    }
  }
  if (!Array.isArray(ws.replyAllowlist)) {
    throw new Error(`${prefix}.replyAllowlist: 配列が必要です`);
  }
  for (const ch of ws.replyAllowlist) {
    if (typeof ch !== "string" || ch.length === 0) {
      throw new Error(`${prefix}.replyAllowlist: 要素は空でない文字列が必要です`);
    }
  }
  if (typeof ws.readExclude !== "object" || ws.readExclude === null) {
    throw new Error(`${prefix}.readExclude: オブジェクトが必要です`);
  }
  for (const field of ["channels", "dmUsers"]) {
    if (!Array.isArray(ws.readExclude[field])) {
      throw new Error(`${prefix}.readExclude.${field}: 配列が必要です`);
    }
  }
}

/**
 * 設定オブジェクト（パース済みJSON）をバリデーションする。
 * @param {unknown} configData
 * @returns {object[]} バリデーション済みのワークスペース配列
 */
export function validateConfig(configData) {
  if (!Array.isArray(configData)) {
    throw new Error("config/workspaces.json はワークスペースの配列である必要があります");
  }
  if (configData.length === 0) {
    throw new Error("config/workspaces.json に少なくとも1つのワークスペースが必要です");
  }
  configData.forEach(validateWorkspace);
  const names = configData.map((ws) => ws.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) {
    throw new Error(`ワークスペース名が重複しています: ${dup}`);
  }
  return configData;
}

/**
 * config/workspaces.json を読み込みバリデーションする。
 * @param {string} configPath
 * @returns {Promise<object[]>}
 */
export async function loadWorkspacesConfig(configPath) {
  const raw = await readFile(configPath, "utf8");
  const data = JSON.parse(raw);
  return validateConfig(data);
}

/**
 * ワークスペース設定から実際のトークン値を環境変数経由で解決する。
 * 値が無い環境変数はそのフィールドを undefined にする（呼び出し側でSKIP判定に使う）。
 * @param {object} workspace
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveWorkspaceSecrets(workspace, env = process.env) {
  return {
    botToken: env[workspace.botTokenEnv],
    userToken: env[workspace.userTokenEnv],
    userId: env[workspace.userIdEnv],
  };
}

/**
 * ワークスペースが投稿を許可されているチャンネルかどうかを判定する。
 * @param {object} workspace
 * @param {string} channelName
 */
export function isAllowlisted(workspace, channelName) {
  return workspace.replyAllowlist.includes(channelName);
}

/**
 * 読み取り対象から除外すべきチャンネルかどうかを判定する。
 * @param {object} workspace
 * @param {string} channelId
 */
export function isExcludedChannel(workspace, channelId) {
  return workspace.readExclude.channels.includes(channelId);
}

/**
 * 読み取り対象から除外すべきDMユーザーかどうかを判定する。
 * @param {object} workspace
 * @param {string} userId
 */
export function isExcludedDmUser(workspace, userId) {
  return workspace.readExclude.dmUsers.includes(userId);
}
