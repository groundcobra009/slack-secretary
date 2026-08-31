// 返信生成: persona/*.md ＋ スレッド文脈 ＋ カレンダー要約からプロンプトを組み立て、
// `claude -p` を呼んで一次応答文を作る。金額・日程確定・契約・約束等はエスカレーション判定して
// 定型の「本人確認」文言に差し替える。

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * brainベースディレクトリから persona/ ディレクトリの絶対パスを組み立てる。
 * persona/ の実データは brain リポジトリに置かれる（このファイル自体はどこにも実データの既定値を持たない）。
 * @param {string} brainDir
 */
export function resolvePersonaDir(brainDir) {
  return path.join(brainDir, "persona");
}

export const ESCALATION_TEXT =
  "この内容は私の判断だけではお答えできないため、本人に確認して戻します。";

// キーワード判定（一段目・保守的に広く拾う）。迷ったらエスカレーション側に倒す。
const ESCALATION_KEYWORDS = [
  "円",
  "¥",
  "万円",
  "見積",
  "請求",
  "値引き",
  "確定",
  "決定します",
  "契約",
  "NDA",
  "秘密保持",
  "サインし",
  "押印",
  "発注",
  "受注",
  "支払い",
  "振込",
  "お約束",
  "約束します",
  "予約します",
];

/**
 * メッセージ本文がキーワード判定でエスカレーション対象かどうかを判定する。
 * @param {string} text
 */
export function isEscalationByKeyword(text) {
  if (typeof text !== "string") return false;
  return ESCALATION_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * persona/*.md を読み込み、返信生成に使う形に整える。
 * @param {string} personaDir
 */
export async function loadPersona(personaDir) {
  const [core, judgment, disclaimerMd] = await Promise.all([
    readFile(path.join(personaDir, "core.md"), "utf8"),
    readFile(path.join(personaDir, "judgment.md"), "utf8"),
    readFile(path.join(personaDir, "disclaimer.md"), "utf8"),
  ]);
  return { core, judgment, disclaimerText: extractDisclaimerText(disclaimerMd) };
}

/**
 * persona/disclaimer.md のコードブロックから固定注記文言を取り出す。
 * @param {string} disclaimerMd
 */
export function extractDisclaimerText(disclaimerMd) {
  const m = disclaimerMd.match(/```\s*\n([\s\S]*?)\n```/);
  if (!m) {
    throw new Error("persona/disclaimer.md からコードブロックの注記文言を抽出できません");
  }
  return m[1].trim();
}

/**
 * 返信本文の末尾に固定注記を必ず付与する。
 * @param {string} text
 * @param {string} disclaimerText
 */
export function withDisclaimer(text, disclaimerText) {
  return `${text.trim()}\n\n${disclaimerText}`;
}

/**
 * claude -p に渡すプロンプトを組み立てる。
 * @param {object} options
 * @param {{core: string, judgment: string}} options.persona
 * @param {string} options.messageText - 本人宛てメンションの本文
 * @param {string} [options.threadContext] - スレッドの文脈（あれば）
 * @param {string} [options.calendarSummary] - 直近予定の要約テキスト
 */
export function buildPrompt({ persona, messageText, threadContext = "", calendarSummary = "" }) {
  return [
    "あなたはSlack常駐AI秘書「けいたろう秘書」です。以下の人格・判断基準に従って、本人宛てメンションに一次応答してください。",
    "",
    "## 人格・口調",
    persona.core,
    "",
    "## 判断基準（エスカレーション基準を含む）",
    persona.judgment,
    "",
    "## 直近の予定（参考情報）",
    calendarSummary || "（取得できませんでした）",
    "",
    "## スレッドの文脈",
    threadContext || "（このメッセージのみ）",
    "",
    "## 本人宛てメッセージ",
    messageText,
    "",
    "## 出力形式（厳守）",
    "以下のJSON形式のみを出力してください。前後に説明文やコードブロック記法を付けないでください。",
    '{"escalate": true か false, "reply": "返信本文（escalateがtrueなら空文字でよい）"}',
    "escalateはエスカレーション基準に該当する場合にtrueにしてください。",
  ].join("\n");
}

/**
 * claude -p の出力（JSON想定）をパースする。壊れている場合は素の文字列を返信文として扱う。
 * @param {string} raw
 */
export function parseClaudeOutput(raw) {
  const trimmed = (raw ?? "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.reply === "string" && typeof parsed.escalate === "boolean") {
      return parsed;
    }
  } catch {
    // JSONでない場合はフォールバック
  }
  return { escalate: false, reply: trimmed };
}

/**
 * `claude -p` を呼び出すクライアントを作る（child_process注入可能）。
 * @param {object} [options]
 * @param {typeof spawn} [options.spawnImpl]
 * @param {string} [options.command]
 * @param {string[]} [options.args]
 */
export function createClaudeClient({ spawnImpl = spawn, command = "claude", args = ["-p"] } = {}) {
  return function claudeClient(prompt) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`claude -p failed (exit ${code}): ${stderr}`));
          return;
        }
        resolve(stdout);
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  };
}

/**
 * 一次応答を生成する。エスカレーション対象なら本人確認の定型文に差し替える。
 * @param {object} options
 * @param {string} options.messageText
 * @param {string} [options.threadContext]
 * @param {string} [options.calendarSummary]
 * @param {{core: string, judgment: string, disclaimerText: string}} options.persona
 * @param {(prompt: string) => Promise<string>} options.claudeClient
 * @returns {Promise<{text: string, escalated: boolean, escalationReason?: string}>}
 */
export async function generateReply({
  messageText,
  threadContext = "",
  calendarSummary = "",
  persona,
  claudeClient,
}) {
  if (isEscalationByKeyword(messageText)) {
    return {
      text: withDisclaimer(ESCALATION_TEXT, persona.disclaimerText),
      escalated: true,
      escalationReason: "keyword",
    };
  }

  const prompt = buildPrompt({ persona, messageText, threadContext, calendarSummary });
  const raw = await claudeClient(prompt);
  const parsed = parseClaudeOutput(raw);

  if (parsed.escalate) {
    return {
      text: withDisclaimer(ESCALATION_TEXT, persona.disclaimerText),
      escalated: true,
      escalationReason: "claude",
    };
  }

  return {
    text: withDisclaimer(parsed.reply, persona.disclaimerText),
    escalated: false,
  };
}
