// 投稿: 「書きは狭く」の担当。allowlistチャンネル以外への投稿は必ず拒否する。
// botトークン（xoxb）でスレッド返信する。

import { isAllowlisted } from "./config.js";

/**
 * allowlist外への投稿を試みたときに投げる例外。
 * メッセージ本文にチャンネル名を含めない（ログ衛生。呼び出し側がログを出す可能性があるため）。
 * チャンネル名が必要な処理は `err.channelName` プロパティ経由で行う。
 */
export class NotAllowlistedError extends Error {
  constructor(channelName) {
    super("チャンネルはreplyAllowlist外のため投稿を拒否しました");
    this.name = "NotAllowlistedError";
    this.channelName = channelName;
  }
}

/**
 * allowlistチャンネル限定でスレッド返信を投稿する。
 * @param {object} options
 * @param {ReturnType<import("./slack.js").createSlackClient>} options.slackClient
 * @param {string} options.botToken - xoxb
 * @param {object} options.workspace - config/workspaces.json の1要素
 * @param {string} options.channelId
 * @param {string} options.channelName
 * @param {string} options.threadTs
 * @param {string} options.text
 * @returns {Promise<object>} Slack API応答
 */
export async function postReply({
  slackClient,
  botToken,
  workspace,
  channelId,
  channelName,
  threadTs,
  text,
}) {
  if (!isAllowlisted(workspace, channelName)) {
    throw new NotAllowlistedError(channelName);
  }
  return slackClient.chatPostMessage(botToken, {
    channel: channelId,
    text,
    thread_ts: threadTs,
  });
}
