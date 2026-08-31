// オーケストレーター: scan → reply → post → state更新。
// 環境変数からトークンを取得し、無ければ「SKIP: secrets not configured」を出して正常終了する。
// persona/config/state の実データは brain リポジトリ（別チェックアウト）に置かれる。
// BRAIN_DIR 環境変数（既定 "./brain"）でその場所を解決し、無ければ「SKIP: brain not found」で正常終了する。

import { loadWorkspacesConfig, resolveWorkspaceSecrets, resolveConfigPath } from "./config.js";
import { createSlackClient } from "./slack.js";
import { scanMentions } from "./scan.js";
import { loadState, saveState, updateLastSeen, resolveStatePath } from "./state.js";
import { parseICS, formatUpcomingEvents } from "./calendar.js";
import { generateReply, loadPersona, createClaudeClient, resolvePersonaDir } from "./reply.js";
import { postReply, NotAllowlistedError } from "./post.js";
import { obfuscateId } from "./log-safe.js";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

export const DEFAULT_BRAIN_DIR = "./brain";

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
  brainDir = env.BRAIN_DIR ?? DEFAULT_BRAIN_DIR,
  configPath,
  statePath,
  personaDir,
  slackClient = createSlackClient(),
  claudeClient = createClaudeClient(),
  fetchIcs = defaultFetchIcs,
  now = new Date(),
  logger = console,
} = {}) {
  // 3つとも明示指定されていない（＝テスト等で個別注入していない）ときだけ brain 存在チェックを行う
  const usesBrainDefaults = !configPath && !statePath && !personaDir;
  if (usesBrainDefaults && !existsSync(brainDir)) {
    logger.log("SKIP: brain not found");
    return { anyConfigured: false, brainFound: false };
  }
  configPath = configPath ?? resolveConfigPath(brainDir);
  statePath = statePath ?? resolveStatePath(brainDir);
  personaDir = personaDir ?? resolvePersonaDir(brainDir);

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
      } catch {
        // ログ衛生: 例外メッセージにはICS URL等が混入しうるため詳細は出さない
        logger.error("カレンダー取得に失敗しました");
      }
    }

    logger.log(`scan: ${events.length} mention(s) found (workspace=${workspace.name})`);

    for (const event of events) {
      let shouldMarkProcessed = true;
      const chLabel = obfuscateId(event.channelId);
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
        // ログ衛生: 返信文・チャンネル名・ユーザー情報は出さない（件数・非復元IDのみ）
        logger.log(`posted (workspace=${workspace.name} channel=${chLabel})`);
      } catch (err) {
        if (err instanceof NotAllowlistedError) {
          // allowlist外は設定を直さない限り解決しないため、再試行はせず処理済み扱いにする
          logger.warn(`skipped: not allowlisted (workspace=${workspace.name} channel=${chLabel})`);
        } else {
          // ログ衛生: err.messageは出さない（返信処理系の例外に本文の断片が混入しうるため）
          logger.error(`failed: reply processing error (workspace=${workspace.name} channel=${chLabel})`);
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
