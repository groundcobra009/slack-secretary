import { test } from "node:test";
import assert from "node:assert/strict";
import { parseICS, formatUpcomingEvents } from "../src/calendar.js";

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1@example.com
DTSTART;TZID=Asia/Tokyo:20260901T100000
DTEND;TZID=Asia/Tokyo:20260901T110000
SUMMARY:定例ミーティング
END:VEVENT
BEGIN:VEVENT
UID:2@example.com
DTSTART:20260902T030000Z
DTEND:20260902T040000Z
SUMMARY:UTC会議
END:VEVENT
BEGIN:VEVENT
UID:3@example.com
DTSTART;VALUE=DATE:20260903
DTEND;VALUE=DATE:20260904
SUMMARY:出張（終日）
END:VEVENT
BEGIN:VEVENT
UID:4@example.com
DTSTART;TZID=Asia/Tokyo:20260910T090000
DTEND;TZID=Asia/Tokyo:20260910T100000
SUMMARY:改行\\nを含むタイトル\\, カンマも
END:VEVENT
END:VCALENDAR`;

test("parseICS: 複数VEVENTをパースできる", () => {
  const events = parseICS(SAMPLE_ICS);
  assert.equal(events.length, 4);
});

test("parseICS: TZID付きの日本語SUMMARYを正しく解釈する", () => {
  const events = parseICS(SAMPLE_ICS);
  const ev = events[0];
  assert.equal(ev.summary, "定例ミーティング");
  // Asia/Tokyo 10:00 = UTC 01:00
  assert.equal(ev.start.toISOString(), "2026-09-01T01:00:00.000Z");
  assert.equal(ev.end.toISOString(), "2026-09-01T02:00:00.000Z");
  assert.equal(ev.allDay, false);
});

test("parseICS: UTC(Z)指定を正しく解釈する", () => {
  const events = parseICS(SAMPLE_ICS);
  const ev = events[1];
  assert.equal(ev.summary, "UTC会議");
  assert.equal(ev.start.toISOString(), "2026-09-02T03:00:00.000Z");
});

test("parseICS: 終日イベント（VALUE=DATE）を解釈する", () => {
  const events = parseICS(SAMPLE_ICS);
  const ev = events[2];
  assert.equal(ev.summary, "出張（終日）");
  assert.equal(ev.allDay, true);
});

test("parseICS: エスケープされた改行・カンマを解除する", () => {
  const events = parseICS(SAMPLE_ICS);
  const ev = events[3];
  assert.equal(ev.summary, "改行\nを含むタイトル, カンマも");
});

test("formatUpcomingEvents: 範囲内のイベントだけを日付順に整形する", () => {
  const events = parseICS(SAMPLE_ICS);
  const now = new Date("2026-08-31T00:00:00Z");
  const text = formatUpcomingEvents(events, { days: 7, now });
  assert.match(text, /今後7日間の予定/);
  assert.match(text, /定例ミーティング/);
  assert.match(text, /UTC会議/);
  assert.match(text, /出張（終日）/);
  assert.doesNotMatch(text, /改行/); // 9/10は範囲外
});

test("formatUpcomingEvents: 該当なしのときはその旨を返す", () => {
  const text = formatUpcomingEvents([], { days: 7, now: new Date("2026-08-31T00:00:00Z") });
  assert.equal(text, "今後7日間の予定: なし");
});
