// 徘徊読み取り: 本人（xoxp）が参加している全チャンネルを横断し、本人宛てメンションを検出する。
// 「読みは広く」の担当。投稿判断や返信生成はここではやらない。

import { isExcludedChannel, isExcludedDmUser } from "./config.js";

/**
 * @typedef {object} MentionEvent
 * @property {string} channelId
 * @property {string} channelName
 * @property {string} ts
 * @property {string} threadTs
 * @property {string} text
 * @property {string} user
 */

/**
 * メッセージが本人宛てメンション（bot発言・自分の発言・既処理を除く）かどうかを判定する。
 * @param {object} msg
 * @param {string} userId
 * @param {string} [lastSeenTs]
 */
function isUnprocessedMention(msg, userId, lastSeenTs) {
  if (!msg || typeof msg.text !== "string") return false;
  if (msg.user === userId) return false; // 自分の発言は除外
  if (msg.bot_id || msg.subtype === "bot_message") return false; // bot発言は除外
  if (lastSeenTs !== undefined && Number(msg.ts) <= Number(lastSeenTs)) return false; // 既処理は除外
  const mentionPattern = new RegExp(`<@${userId}>`);
  return mentionPattern.test(msg.text);
}

/**
 * 参加中の全チャンネルを横断して本人宛て未処理メンションを集める。
 * @param {object} options
 * @param {ReturnType<import("./slack.js").createSlackClient>} options.slackClient
 * @param {string} options.userToken - xoxp
 * @param {string} options.userId
 * @param {object} options.workspace - config/workspaces.json の1要素
 * @param {object} [options.lastSeen] - { channelId: ts } 形式（このワークスペース分のみ渡す）
 * @returns {Promise<MentionEvent[]>}
 */
export async function scanMentions({ slackClient, userToken, userId, workspace, lastSeen = {} }) {
  const convResp = await slackClient.usersConversations(userToken, {
    types: "public_channel,private_channel,mpim,im",
    exclude_archived: true,
    limit: 200,
  });
  const channels = convResp.channels ?? [];
  const events = [];

  for (const channel of channels) {
    if (isExcludedChannel(workspace, channel.id)) continue;
    if (channel.is_im && isExcludedDmUser(workspace, channel.user)) continue;

    const lastSeenTs = lastSeen[channel.id];
    const histResp = await slackClient.conversationsHistory(userToken, {
      channel: channel.id,
      oldest: lastSeenTs,
      limit: 50,
    });
    const messages = histResp.messages ?? [];
    // Slackは新しい順で返す。処理順を安定させるため古い順に並べ替える。
    const sorted = [...messages].sort((a, b) => Number(a.ts) - Number(b.ts));

    for (const msg of sorted) {
      if (!isUnprocessedMention(msg, userId, lastSeenTs)) continue;
      events.push({
        channelId: channel.id,
        channelName: channel.name ?? channel.id,
        ts: msg.ts,
        threadTs: msg.thread_ts ?? msg.ts,
        text: msg.text,
        user: msg.user,
      });
    }
  }

  return events;
}
