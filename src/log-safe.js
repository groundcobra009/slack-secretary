// ログ衛生ユーティリティ: Actionsログは全公開になる前提で、
// チャンネルIDなどの識別子をログに出す際は「先頭4文字＋ハッシュ」の非復元形に変換する。
// メッセージ本文・チャンネル名・ユーザー名・ユーザーIDはそもそもログに渡さないこと（呼び出し側の責務）。

import { createHash } from "node:crypto";

/**
 * チャンネルID等の識別子を、ログに出してよい非復元形（先頭4文字＋短いハッシュ）に変換する。
 * @param {string} id
 * @returns {string}
 */
export function obfuscateId(id) {
  const str = String(id ?? "");
  const prefix = str.slice(0, 4);
  const hash = createHash("sha256").update(str).digest("hex").slice(0, 8);
  return `${prefix}#${hash}`;
}
