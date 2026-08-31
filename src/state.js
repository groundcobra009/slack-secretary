// state/last_seen.json の読み書き。チャンネルごとの「最後に処理したメッセージts」だけを持つ。
// 生の会話ログは一切保存しない（タイムスタンプ文字列のみ）。
// state/ の実データは brain リポジトリに置かれる（このファイル自体はどこにも実データの既定値を持たない）。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * brainベースディレクトリから state/last_seen.json の絶対パスを組み立てる。
 * @param {string} brainDir
 */
export function resolveStatePath(brainDir) {
  return path.join(brainDir, "state", "last_seen.json");
}

/**
 * state/last_seen.json を読み込む。存在しない・壊れている場合は空オブジェクトを返す。
 * 形式: { "<workspaceName>": { "<channelId>": "<ts>", ... }, ... }
 * @param {string} statePath
 * @returns {Promise<object>}
 */
export async function loadState(statePath) {
  try {
    const raw = await readFile(statePath, "utf8");
    const data = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return {};
    }
    return data;
  } catch (err) {
    if (err.code === "ENOENT") return {};
    // JSON壊れ等は空扱いにして安全側に倒す（重複投稿はチェック段階で防ぐ）
    return {};
  }
}

/**
 * state/last_seen.json を書き込む。
 * @param {object} state
 * @param {string} statePath
 */
export async function saveState(state, statePath) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * 指定ワークスペース・チャンネルの最終処理tsを取得する。
 * @param {object} state
 * @param {string} workspaceName
 * @param {string} channelId
 * @returns {string|undefined}
 */
export function getLastSeen(state, workspaceName, channelId) {
  return state?.[workspaceName]?.[channelId];
}

/**
 * 指定ワークスペース・チャンネルの最終処理tsを更新する（既存より新しい場合のみ）。
 * 元のstateは変更せず、新しいオブジェクトを返す（イミュータブル）。
 * @param {object} state
 * @param {string} workspaceName
 * @param {string} channelId
 * @param {string} ts
 * @returns {object} 更新後のstate
 */
export function updateLastSeen(state, workspaceName, channelId, ts) {
  const current = getLastSeen(state, workspaceName, channelId);
  if (current !== undefined && Number(current) >= Number(ts)) {
    return state;
  }
  return {
    ...state,
    [workspaceName]: {
      ...(state[workspaceName] ?? {}),
      [channelId]: ts,
    },
  };
}
