import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isEscalationByKeyword,
  extractDisclaimerText,
  withDisclaimer,
  buildPrompt,
  parseClaudeOutput,
  createClaudeClient,
  generateReply,
  loadPersona,
  resolvePersonaDir,
  ESCALATION_TEXT,
} from "../src/reply.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BRAIN_DIR = path.join(__dirname, "fixtures", "brain");

const persona = {
  core: "丁寧に振る舞う",
  judgment: "金額は確認する",
  disclaimerText: "（※これはけいたろうの秘書AIによる一次応答です。正式な回答は、追って本人からあらためてお送りします）",
};

test("isEscalationByKeyword: 金額を含む発言はtrue", () => {
  assert.equal(isEscalationByKeyword("見積は30万円でお願いします"), true);
});

test("isEscalationByKeyword: 通常の質問はfalse", () => {
  assert.equal(isEscalationByKeyword("資料の場所を教えてください"), false);
});

test("extractDisclaimerText: コードブロックから注記文言を取り出す", () => {
  const md = "# 固定注記\n\n```\n（※これはテスト注記）\n```\n";
  assert.equal(extractDisclaimerText(md), "（※これはテスト注記）");
});

test("withDisclaimer: 本文末尾に必ず注記が付く", () => {
  const text = withDisclaimer("承知しました。", persona.disclaimerText);
  assert.ok(text.endsWith(persona.disclaimerText));
  assert.ok(text.startsWith("承知しました。"));
});

test("buildPrompt: persona・文脈・カレンダー・本文を含む", () => {
  const prompt = buildPrompt({
    persona,
    messageText: "明日空いてますか",
    threadContext: "前の発言",
    calendarSummary: "今後7日間の予定: なし",
  });
  assert.match(prompt, /丁寧に振る舞う/);
  assert.match(prompt, /金額は確認する/);
  assert.match(prompt, /前の発言/);
  assert.match(prompt, /今後7日間の予定: なし/);
  assert.match(prompt, /明日空いてますか/);
});

test("parseClaudeOutput: 正しいJSONをパースする", () => {
  const parsed = parseClaudeOutput('{"escalate": false, "reply": "承知しました"}');
  assert.deepEqual(parsed, { escalate: false, reply: "承知しました" });
});

test("parseClaudeOutput: JSONでない出力はそのまま返信文として扱う", () => {
  const parsed = parseClaudeOutput("承知しました（JSONではない出力）");
  assert.equal(parsed.escalate, false);
  assert.equal(parsed.reply, "承知しました（JSONではない出力）");
});

test("generateReply: キーワード判定でエスカレーションし、claudeを呼ばない", async () => {
  let called = false;
  const claudeClient = async () => {
    called = true;
    return '{"escalate": false, "reply": "呼ばれてはいけない"}';
  };
  const result = await generateReply({
    messageText: "契約書にサインしてもらえますか",
    persona,
    claudeClient,
  });
  assert.equal(result.escalated, true);
  assert.equal(result.escalationReason, "keyword");
  assert.match(result.text, new RegExp(ESCALATION_TEXT.slice(0, 10)));
  assert.ok(result.text.endsWith(persona.disclaimerText));
  assert.equal(called, false);
});

test("generateReply: claude判定でエスカレーションする", async () => {
  const claudeClient = async () => '{"escalate": true, "reply": ""}';
  const result = await generateReply({
    messageText: "この件、進めておいてもらえますか",
    persona,
    claudeClient,
  });
  assert.equal(result.escalated, true);
  assert.equal(result.escalationReason, "claude");
  assert.ok(result.text.endsWith(persona.disclaimerText));
});

test("generateReply: 通常応答には必ず注記が末尾に付く", async () => {
  const claudeClient = async () => '{"escalate": false, "reply": "資料はDrive内の共有フォルダにあります"}';
  const result = await generateReply({
    messageText: "資料はどこですか",
    persona,
    claudeClient,
  });
  assert.equal(result.escalated, false);
  assert.equal(
    result.text,
    withDisclaimer("資料はDrive内の共有フォルダにあります", persona.disclaimerText)
  );
  assert.ok(result.text.endsWith(persona.disclaimerText));
});

test("createClaudeClient: spawnを注入してstdin/stdoutをやり取りできる", async () => {
  function fakeSpawn(command, args) {
    assert.equal(command, "claude");
    assert.deepEqual(args, ["-p"]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const written = [];
    child.stdin = {
      write: (data) => written.push(data),
      end: () => {
        queueMicrotask(() => {
          child.stdout.emit("data", '{"escalate": false, "reply": "ok"}');
          child.emit("close", 0);
        });
      },
    };
    child._written = written;
    return child;
  }

  const client = createClaudeClient({ spawnImpl: fakeSpawn });
  const output = await client("test-prompt");
  assert.equal(output, '{"escalate": false, "reply": "ok"}');
});

test("createClaudeClient: 非ゼロ終了コードは例外を投げる", async () => {
  function fakeSpawn() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: () => {},
      end: () => {
        queueMicrotask(() => {
          child.stderr.emit("data", "auth error");
          child.emit("close", 1);
        });
      },
    };
    return child;
  }
  const client = createClaudeClient({ spawnImpl: fakeSpawn });
  await assert.rejects(() => client("test-prompt"), /exit 1/);
});

test("loadPersona: fixtureのpersona/*.mdを読み込める", async () => {
  const loaded = await loadPersona(resolvePersonaDir(FIXTURE_BRAIN_DIR));
  assert.match(loaded.core, /私/);
  assert.match(loaded.judgment, /エスカレーション/);
  assert.ok(loaded.disclaimerText.includes("けいたろうの秘書AI"));
});
