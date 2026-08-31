// Slack Web API の薄いラッパ。fetch実装を注入可能にしてテストではモックする。

const DEFAULT_BASE_URL = "https://slack.com/api";

/**
 * Slack Web API クライアントを作る。
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] - 注入用のfetch実装（テストではモックを渡す）
 * @param {string} [options.baseUrl]
 */
export function createSlackClient({ fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL } = {}) {
  /**
   * Slack Web API を1回呼び出す。
   * @param {string} method - 例: "users.conversations"
   * @param {string} token
   * @param {object} [params]
   */
  async function call(method, token, params = {}) {
    const res = await fetchImpl(`${baseUrl}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(`Slack API error (${method}): ${data.error ?? "unknown_error"}`);
      err.slackError = data.error;
      err.method = method;
      throw err;
    }
    return data;
  }

  return {
    /** 本人（xoxp）が参加しているチャンネル・DM・グループDMを列挙する */
    usersConversations: (token, params) => call("users.conversations", token, params),
    /** 指定チャンネルの発言履歴を取得する */
    conversationsHistory: (token, params) => call("conversations.history", token, params),
    /** 指定チャンネルへ投稿する（通常はbotトークンで使う） */
    chatPostMessage: (token, params) => call("chat.postMessage", token, params),
  };
}
