// オーケストレーター: scan → reply → post → state更新。
// 環境変数からトークンを取得し、無ければ「SKIP: secrets not configured」を出して正常終了する。

import { loadWorkspacesConfig, resolveWorkspaceSecrets, DEFAULT_CONFIG_PATH } from "./config.js";
import { createSlackClient } from "./slack.js";
import { scanMentions } from "./scan.js";
import { loadState, saveState, updateLastSeen, DEFAULT_STATE_PATH } from "./state.js";
import { parseICS, formatUpcomingEvents } from "./calendar.js";
import { generateReply, loadPersona, createClaudeClient, DEFAULT_PERSONA_DIR } from "./reply.js";
import { postReply, NotAllowlistedError } from "./post.js";
import { pathToFileURL } from "node:url";

/**
 * ICS限定公開URLを取得する既定実装（fetch標準のみ・依存追加なし）。
 * @param {string} url
 */
async function defaultFetchIcs(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ICS取得に失敗しました: HTTP ${res.status}`);
  }
  return res.text();
}

/**
 * けいたろう秘書 Phase 1 の1回分の実行（scan→reply→post→state更新）。
 * すべての外部依存は注入可能（テストではモックする）。
 * @param {object} [options]
 */
export async function run({
  env = process.env,
  configPath = DEFAULT_CONFIG_PATH,
  statePath = DEFAULT_STATE_PATH,
  personaDir = DEFAULT_PERSONA_DIR,
  slackClient = createSlackClient(),
  claudeClient = createClaudeClient(),
  fetchIcs = defaultFetchIcs,
  now = new Date(),
  logger = console,
} = {}) {
  const workspaces = await loadWorkspacesConfig(configPath);
  let state = await loadState(statePath);
  const persona = await loadPersona(personaDir);

  let anyConfigured = false;

  for (const workspace of workspaces) {
    const secrets = resolveWorkspaceSecrets(workspace, env);
    if (!secrets.botToken || !secrets.userToken || !secrets.userId) {
      logger.log(`SKIP: secrets not configured for workspace "${workspace.name}"`);
      continue;
    }
    anyConfigured = true;

    const wsLastSeen = state[workspace.name] ?? {};
    const events = await scanMentions({
      slackClient,
      userToken: secrets.userToken,
      userId: secrets.userId,
      workspace,
      lastSeen: wsLastSeen,
    });

    let calendarSummary = "";
    if (env.GCAL_ICS_URL) {
      try {
        const icsText = await fetchIcs(env.GCAL_ICS_URL);
        calendarSummary = formatUpcomingEvents(parseICS(icsText), { now });
      } catch (err) {
        logger.error(`カレンダー取得に失敗しました: ${err.message}`);
      }
    }

    for (const event of events) {
      let shouldMarkProcessed = true;
      try {
        const reply = await generateReply({
          messageText: event.text,
          calendarSummary,
          persona,
          claudeClient,
        });
        await postReply({
          slackClient,
          botToken: secrets.botToken,
          workspace,
          channelId: event.channelId,
          channelName: event.channelName,
          threadTs: event.threadTs,
          text: reply.text,
        });
      } catch (err) {
        if (err instanceof NotAllowlistedError) {
          // allowlist外は設定を直さない限り解決しないため、再試行はせず処理済み扱いにする
          logger.warn(`SKIP投稿: ${err.message}`);
        } else {
          logger.error(
            `返信処理に失敗しました (workspace=${workspace.name} channel=${event.channelId} ts=${event.ts}): ${err.message}`
          );
          shouldMarkProcessed = false; // 次回リトライできるようstateは更新しない
        }
      }
      if (shouldMarkProcessed) {
        state = updateLastSeen(state, workspace.name, event.channelId, event.ts);
      }
    }
  }

  await saveState(state, statePath);

  if (!anyConfigured) {
    logger.log("SKIP: secrets not configured");
  }

  return { anyConfigured };
}

// CLIエントリポイント（このファイルが直接実行されたときのみ動く）
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
