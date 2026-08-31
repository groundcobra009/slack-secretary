// 個人GoogleカレンダーのICS（限定公開URL）を読み取るための最小パーサ。
// VEVENT / DTSTART / DTEND / SUMMARY のみ対応。タイムゾーンは TZID付き と UTC(Z) のみ対応。

/**
 * ICSテキストの行折り返し（RFC5545）を解消する。
 * 継続行は先頭が半角スペース or タブで始まる。
 * @param {string} icsText
 * @returns {string[]}
 */
function unfoldLines(icsText) {
  const rawLines = icsText.split(/\r\n|\n|\r/);
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * 1行を `NAME;PARAM=VAL;...:VALUE` の形でパースする。
 * @param {string} line
 */
function parseLine(line) {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return { name: line, params: {}, value: "" };
  const head = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const [name, ...paramParts] = head.split(";");
  const params = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    params[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * ICSのテキスト値（SUMMARY等）のエスケープを解除する。
 * @param {string} value
 */
function unescapeText(value) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * 指定タイムゾーン（IANA名）での壁時計時刻とUTC瞬間の差（ms）を求める。
 * Node標準搭載のIntlタイムゾーンDBを使うためランタイム依存は増えない。
 * @param {number} utcMs
 * @param {string} timeZone
 */
function getOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asIfUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asIfUTC - utcMs;
}

/**
 * 指定タイムゾーンでの壁時計時刻（年月日時分秒）をUTC瞬間（Date）に変換する。
 * DST境界近辺のズレを抑えるため2回補正する。
 */
function zonedTimeToUtc(y, mo, d, h, mi, s, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset1 = getOffsetMs(guess, timeZone);
  const utc1 = guess - offset1;
  const offset2 = getOffsetMs(utc1, timeZone);
  return new Date(guess - offset2);
}

/**
 * DTSTART/DTENDの値をパースしてDateとallDayフラグを返す。
 * @param {object} params
 * @param {string} value
 */
function parseDateValue(params, value) {
  // 終日（VALUE=DATE または YYYYMMDD のみ）
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const mo = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    return { date: new Date(Date.UTC(y, mo - 1, d)), allDay: true };
  }

  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return { date: null, allDay: false };
  const [, y, mo, d, h, mi, s, zFlag] = m;
  const [yy, moo, dd, hh, mii, ss] = [y, mo, d, h, mi, s].map(Number);

  if (zFlag === "Z") {
    return { date: new Date(Date.UTC(yy, moo - 1, dd, hh, mii, ss)), allDay: false };
  }
  if (params.TZID) {
    return { date: zonedTimeToUtc(yy, moo, dd, hh, mii, ss, params.TZID), allDay: false };
  }
  // floating time（TZIDもZも無い）: 未対応のためUTCとみなす（既知の制約）
  return { date: new Date(Date.UTC(yy, moo - 1, dd, hh, mii, ss)), allDay: false };
}

/**
 * ICSテキストをパースしてVEVENTの配列を返す。
 * @param {string} icsText
 * @returns {Array<{summary: string, start: Date|null, end: Date|null, allDay: boolean}>}
 */
export function parseICS(icsText) {
  const lines = unfoldLines(icsText);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = { summary: "(無題の予定)", start: null, end: null, allDay: false };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const { name, params, value } = parseLine(line);
    if (name === "SUMMARY") {
      current.summary = unescapeText(value) || "(無題の予定)";
    } else if (name === "DTSTART") {
      const { date, allDay } = parseDateValue(params, value);
      current.start = date;
      current.allDay = allDay;
    } else if (name === "DTEND") {
      const { date } = parseDateValue(params, value);
      current.end = date;
    }
  }

  return events;
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

function formatDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_JA[date.getDay()]})`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * イベント配列を「今後N日の予定一覧」のテキストに整形する。
 * @param {Array<{summary: string, start: Date|null, end: Date|null, allDay: boolean}>} events
 * @param {object} [options]
 * @param {number} [options.days] - 何日先まで含めるか
 * @param {Date} [options.now]
 * @returns {string}
 */
export function formatUpcomingEvents(events, { days = 7, now = new Date() } = {}) {
  const rangeEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const upcoming = events
    .filter((e) => e.start && e.start >= now && e.start <= rangeEnd)
    .sort((a, b) => a.start - b.start);

  if (upcoming.length === 0) {
    return `今後${days}日間の予定: なし`;
  }

  const lines = upcoming.map((e) => {
    const dateStr = formatDate(e.start);
    const timeStr = e.allDay
      ? "終日"
      : e.end
        ? `${formatTime(e.start)}〜${formatTime(e.end)}`
        : formatTime(e.start);
    return `- ${dateStr} ${timeStr} ${e.summary}`;
  });

  return [`今後${days}日間の予定:`, ...lines].join("\n");
}
