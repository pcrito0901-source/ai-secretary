// Core data operations for the AI secretary. No third-party dependencies.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION = "0.1.0";
const CONFIG_VERSION = 1;
const BASE_DIRS = ["todos", "inbox", "notes", "decisions", "briefs", "departments"];
const LOCK_FILE = ".lock";
const STALE_LOCK_MS = 30_000;
const MAX_MARKDOWN_BYTES = 1024 * 1024;

export class UserError extends Error {}

export const PRIORITIES = [
  { key: "high", heading: "最優先" },
  { key: "normal", heading: "通常" },
  { key: "low", heading: "余裕があれば" },
];
const NOTES_HEADING = "メモ・振り返り";
const PRIORITY_ALIASES = {
  high: "high", h: "high", "高": "high", "最優先": "high",
  normal: "normal", n: "normal", "中": "normal", "通常": "normal",
  low: "low", l: "low", "低": "low", "余裕があれば": "low",
};

const COMMON_RULES = [
  "1トピック1ファイルで保存する。ファイル名は `YYYY-MM-DD-タイトル.md` か `タイトル.md`",
  "既存の記録は上書きせず、追記するか新しいファイルを作る",
  "パスワード・APIキー・カード番号などの秘密情報は保存しない",
];

export const DEPARTMENTS = {
  research: {
    name: "リサーチ", role: "市場調査・競合分析・技術調査・アイデアの需要検証", folders: ["topics", "ideas"],
    rules: [
      "調査は `topics/` に保存し、情報源（URLや出典）・結論・次のアクションを必ず書く",
      "App Store レビューの分析は `topics/reviews/` に保存する（review-insights スキル）",
      "アイデアの需要検証は `ideas/<アイデアID>.md` に1ファイルで記録する（idea-check スキル）。段階ごとの合格ラインは、始める前に書く",
    ],
  },
  pm: {
    name: "PM", role: "プロジェクトの進捗・マイルストーン管理", folders: ["projects"],
    rules: [
      "プロジェクトは `projects/プロジェクト名.md` に1ファイルで管理し、ゴールとマイルストーンを書く",
      "マイルストーンは `## マイルストーン` の下に `- [ ] 内容（期限: YYYY-MM-DD）` の形で書く（朝のまとめに7日以内のものが載る）。追加・完了・期限の変更は `secretary.mjs pm` コマンドで行う",
      "進捗は `## 進捗ログ` に日付付きで追記する（`secretary.mjs pm log`）",
      "開発のリポジトリがあれば `secretary.mjs pm link <プロジェクトID> --repo <フォルダ>` でつなぐ（朝のまとめに開発の動きが載る）",
    ],
  },
  marketing: {
    name: "マーケティング", role: "アプリの集客・SNS・キャンペーン・数字の振り返り", folders: ["apps", "content", "campaigns", "reports"],
    rules: [
      "アプリごとの前提情報は `apps/<アプリID>.md`、SNS投稿案は `content/`、キャンペーンは `campaigns/`、週次レポートは `reports/` に保存する",
      "投稿の実績は `post-log.md` に記録する（marketing-hq スキルの growth.mjs を使う）",
      "KPIは数値で記録する。企業案件やクリエイターへの依頼投稿には必ずPR表記を入れる（ステマ規制）",
      "公開する文（SNS・ストア・広告・LP）に、他社のアプリ名・サービス名を使わない。「〇〇版」「〇〇風」のたとえやハッシュタグも使わない。例外は、連携先を事実として中立に書く場合だけ",
      "宣伝の投稿に使う音楽は、商用利用できるものだけにする（個人向けのトレンドの曲は使わない）",
      "「公開した」「直した」「審査に出した」などの事実は、PM のマイルストーンやアプリの状態で確かめてから書く",
    ],
  },
  engineering: {
    name: "開発", role: "技術メモ・設計・デバッグ記録", folders: ["docs", "debug-log"],
    rules: ["設計や技術メモは `docs/`、不具合調査は `debug-log/` に保存する", "デバッグ記録には原因と再発防止策を書く"],
  },
  quality: {
    name: "品質管理", role: "テスト・バグ整理・リリース前確認", folders: ["bugs", "releases"],
    rules: ["バグは `bugs/` に再現手順・期待結果・実際の結果を書いて保存する", "リリース前チェックは `releases/` に保存する"],
  },
  finance: {
    name: "経理", role: "請求書・経費・売上の記録", folders: ["invoices", "expenses"],
    rules: ["請求書は `invoices/`、経費は `expenses/YYYY-MM.md` に保存する", "金額は税込・税抜を明記する"],
  },
  sales: {
    name: "営業", role: "クライアント・提案書・案件管理", folders: ["clients", "proposals"],
    rules: ["クライアントは `clients/会社名.md` に1ファイルで管理し、やり取りを日付付きで追記する", "提案書は `proposals/` に保存する"],
  },
  creative: {
    name: "クリエイティブ", role: "デザインブリーフ・ブランド管理", folders: ["briefs"],
    rules: ["デザイン依頼は `briefs/` に目的・対象・トーン・要件を書いて保存する"],
  },
  analytics: {
    name: "分析", role: "アプリの数字（集客〜収益）の記録・穴の診断・改善の管理", folders: ["apps", "reports"],
    rules: [
      "アプリごとに `apps/<アプリID>/` を作り、`bucket.md`（バケツの設計図）・`metrics.json`（指標の定義と週ごとの数字）・`experiments.md`（改善ボード）を置く",
      "数字の記録は bucket-check スキルの metrics.mjs で行い、metrics.json を手で書き換えない",
      "週ごとの診断は `reports/<アプリID>-<YYYY-Www>.md` に保存する",
      "利用者が少ない時期は割合がぶれやすいので、人数（分母）も必ず記録する",
    ],
  },
  hr: {
    name: "人事", role: "採用・オンボーディング", folders: ["hiring"],
    rules: ["採用は `hiring/ポジション名.md` に保存する", "候補者の個人情報は必要最小限にする"],
  },
};

// ---------- basics ----------

export function resolveHome(explicit) {
  const raw = explicit || process.env.AI_SECRETARY_HOME || path.join(os.homedir(), "ai-secretary");
  return path.resolve(raw);
}

const WEEKDAYS = "日月火水木金土";

export function formatDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseDate(value, label = "日付") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UserError(`${label}は YYYY-MM-DD の形で指定してください（例: 2026-09-30）。`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new UserError(`${label}「${value}」は存在しない日付です。`);
  }
  return date;
}

export function addDays(value, days) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

export function weekday(value) {
  return WEEKDAYS[parseDate(value).getDay()];
}

function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86_400_000);
}

// Accepts YYYY-MM-DD, today/今日, tomorrow/明日, or +N (days from today).
export function resolveDateInput(value, label = "日付") {
  const text = String(value ?? "").trim();
  const now = formatDate();
  if (["today", "今日", "きょう"].includes(text)) return now;
  if (["tomorrow", "明日", "あした"].includes(text)) return addDays(now, 1);
  const offset = text.match(/^\+(\d{1,3})$/);
  if (offset) return addDays(now, Number(offset[1]));
  parseDate(text, label);
  return text;
}

export function oneLine(value, label, max = 500) {
  if (typeof value !== "string" || !value.trim()) throw new UserError(`${label}を入力してください。`);
  const text = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (text.length > max) throw new UserError(`${label}は${max}文字以内にしてください。`);
  return text;
}

export function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Write via a temp file + rename so a crash never leaves a half-written file.
// Windows can briefly refuse the rename while an editor or sync client holds the file.
export function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, content, "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temporary, file);
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 5) {
        fs.rmSync(temporary, { force: true });
        throw error;
      }
      sleep(50 * (attempt + 1));
    }
  }
}

// Serialises writers (CLI and dashboard). A lock older than STALE_LOCK_MS is treated as abandoned.
export function withLock(home, action) {
  const lockPath = path.join(home, LOCK_FILE);
  let descriptor;
  for (let attempt = 0; attempt < 50 && descriptor === undefined; attempt += 1) {
    try {
      descriptor = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      sleep(100);
    }
  }
  if (descriptor === undefined) throw new UserError("別の書き込みが終わらないため中断しました。少し待ってから再実行してください。");
  try {
    return action();
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
  }
}

// ---------- config ----------

const configFile = (home) => path.join(home, "config.json");
const validDepartmentId = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);

export function isInitialized(home) {
  return fs.existsSync(configFile(home));
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new UserError("config.json の中身が壊れています。");
  if (config.version !== CONFIG_VERSION) throw new UserError(`config.json のバージョン ${config.version} には対応していません。`);
  if (!config.owner || typeof config.owner.business !== "string" || typeof config.owner.goals !== "string") {
    throw new UserError("config.json に owner（business / goals）がありません。");
  }
  if (!Array.isArray(config.departments)) throw new UserError("config.json の departments が配列ではありません。");
  const seen = new Set();
  for (const department of config.departments) {
    if (!validDepartmentId(department?.id) || seen.has(department.id) || typeof department.name !== "string") {
      throw new UserError(`config.json の部署定義が不正です: ${JSON.stringify(department)}`);
    }
    seen.add(department.id);
  }
  if (config.repos !== undefined) {
    const valid = config.repos && typeof config.repos === "object" && !Array.isArray(config.repos)
      && Object.entries(config.repos).every(([id, repo]) => validDepartmentId(id) && typeof repo === "string" && repo.length > 0);
    if (!valid) throw new UserError("config.json の repos が不正です（{ \"プロジェクトID\": \"フォルダのパス\" } の形にしてください）。");
  }
  return config;
}

export function readConfig(home) {
  if (!isInitialized(home)) {
    throw new UserError(`AI秘書はまだ初期化されていません（${home}）。先に init を実行してください。`);
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile(home), "utf8"));
  } catch (error) {
    throw new UserError(`config.json を読み込めません: ${error.message}`);
  }
  return validateConfig(config);
}

function saveConfig(home, config) {
  writeFileAtomic(configFile(home), `${JSON.stringify(validateConfig(config), null, 2)}\n`);
}

export function init(home, { business, goals } = {}) {
  if (isInitialized(home)) return { home, alreadyInitialized: true, owner: readConfig(home).owner };
  const owner = {
    business: oneLine(business, "事業・活動（--business）", 300),
    goals: oneLine(goals, "目標・困りごと（--goals）", 300),
    createdDate: formatDate(),
  };
  fs.mkdirSync(home, { recursive: true });
  return withLock(home, () => {
    for (const dir of BASE_DIRS) fs.mkdirSync(path.join(home, dir), { recursive: true });
    saveConfig(home, { version: CONFIG_VERSION, owner, departments: [] });
    const { file, carried } = ensureTodo(home, formatDate());
    return { home, alreadyInitialized: false, owner, todoFile: file, carried: carried.length };
  });
}

export function setProfile(home, { business, goals } = {}) {
  if (business === undefined && goals === undefined) throw new UserError("--business か --goals を指定してください。");
  readConfig(home);
  return withLock(home, () => {
    const config = readConfig(home);
    if (business !== undefined) config.owner.business = oneLine(business, "事業・活動", 300);
    if (goals !== undefined) config.owner.goals = oneLine(goals, "目標・困りごと", 300);
    saveConfig(home, config);
    return { home, owner: config.owner };
  });
}

// ---------- TODO ----------

const TODO_NAME = /^(\d{4}-\d{2}-\d{2})\.md$/;
const ITEM_RE = /^(\s*[-*]\s+\[)( |x|X|>)(\]\s+)(.*)$/;
const DUE_RE = /\s*（期限:\s*(\d{4}-\d{2}-\d{2})）\s*$/;

const todoFile = (home, date) => path.join(home, "todos", `${date}.md`);

function todoTemplate(date) {
  const headings = [...PRIORITIES.map((priority) => priority.heading), NOTES_HEADING];
  return `# TODO ${date}（${weekday(date)}）\n\n${headings.map((heading) => `## ${heading}\n`).join("\n")}`;
}

function listTodoDates(home) {
  let names = [];
  try {
    names = fs.readdirSync(path.join(home, "todos"));
  } catch {
    return [];
  }
  return names.map((name) => name.match(TODO_NAME)?.[1]).filter(Boolean).sort();
}

function priorityOf(section) {
  return PRIORITIES.find((priority) => priority.heading === section)?.key ?? "normal";
}

function headingOf(priority) {
  return PRIORITIES.find((entry) => entry.key === priority).heading;
}

export function parseTodo(content) {
  const lines = content.split(/\r?\n/);
  const items = [];
  let section = null;
  let number = 0;
  lines.forEach((line, index) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1];
      return;
    }
    const match = line.match(ITEM_RE);
    if (!match) return;
    const status = match[2] === " " ? "open" : match[2] === ">" ? "carried" : "done";
    items.push({
      n: status === "carried" ? null : ++number,
      line: index,
      priority: priorityOf(section),
      status,
      text: match[4].replace(DUE_RE, "").trim(),
      due: match[4].match(DUE_RE)?.[1] ?? null,
      raw: match[4],
    });
  });
  return { lines, items };
}

function insertIntoSection(content, heading, newLine) {
  const lines = content.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  let start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    let at = lines.findIndex((line) => line.trim() === `## ${NOTES_HEADING}`);
    if (at < 0) {
      lines.push("");
      at = lines.length;
    }
    lines.splice(at, 0, `## ${heading}`, "");
    start = at;
  }
  let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  if (end < 0) end = lines.length;
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at -= 1;
  lines.splice(at, 0, newLine);
  if (lines[at + 1] !== undefined && /^##\s+/.test(lines[at + 1])) lines.splice(at + 1, 0, "");
  return `${lines.join("\n")}\n`;
}

// Creates the TODO file for `date` if needed. Only today's file inherits unfinished
// items from the most recent earlier day; those are marked `[>]` (carried) at the source.
// Callers must hold the lock.
function ensureTodo(home, date) {
  const file = todoFile(home, date);
  if (fs.existsSync(file)) return { file, created: false, carried: [] };
  let content = todoTemplate(date);
  const carried = [];
  let previous = null;
  if (date === formatDate()) {
    const previousDate = listTodoDates(home).filter((candidate) => candidate < date).at(-1);
    if (previousDate) {
      const parsed = parseTodo(fs.readFileSync(todoFile(home, previousDate), "utf8"));
      for (const item of parsed.items.filter((entry) => entry.status === "open")) {
        content = insertIntoSection(content, headingOf(item.priority), `- [ ] ${item.raw}`);
        parsed.lines[item.line] = parsed.lines[item.line].replace(ITEM_RE, "$1>$3$4");
        carried.push({ text: item.text, from: previousDate });
      }
      if (carried.length) previous = { file: todoFile(home, previousDate), content: parsed.lines.join("\n") };
    }
  }
  writeFileAtomic(file, content);
  if (previous) writeFileAtomic(previous.file, previous.content);
  return { file, created: true, carried };
}

function normalizePriority(value) {
  const key = PRIORITY_ALIASES[String(value ?? "normal").trim()];
  if (!key) throw new UserError("優先度は high / normal / low（高 / 通常 / 低）のどれかで指定してください。");
  return key;
}

const publicItem = ({ n, line, priority, status, text, due }) => ({ n, line, priority, status, text, due });

// `replace`: open items starting with this prefix are removed first, so a routine that adds
// "SNS投稿: …" every morning keeps only the newest one. Removed items are noted in the memo section.
export function addTodo(home, { text, priority, due, date, replace } = {}) {
  readConfig(home);
  const task = oneLine(text, "TODOの内容", 300).replace(DUE_RE, "");
  const key = normalizePriority(priority);
  const dueDate = due ? resolveDateInput(due, "期限") : null;
  const target = date ? resolveDateInput(date) : formatDate();
  const prefix = replace === undefined ? null : oneLine(replace, "置き換える TODO の先頭（--replace）", 300);
  return withLock(home, () => {
    const { file } = ensureTodo(home, target);
    let content = fs.readFileSync(file, "utf8");
    const replaced = [];
    if (prefix) {
      const parsed = parseTodo(content);
      const stale = parsed.items.filter((item) => item.status === "open" && item.text !== task && item.text.startsWith(prefix));
      if (stale.length) {
        const drop = new Set(stale.map((item) => item.line));
        content = parsed.lines.filter((_, index) => !drop.has(index)).join("\n");
        for (const item of stale) {
          content = insertIntoSection(content, NOTES_HEADING, `- ${formatTime()} 置き換え: ${item.text}`);
          replaced.push(item.text);
        }
      }
    }
    const duplicate = parseTodo(content).items.find((item) => item.status === "open" && item.text === task);
    if (duplicate) {
      if (replaced.length) writeFileAtomic(file, content);
      return { file, date: target, added: false, reason: "同じTODOがすでにあります", item: publicItem(duplicate), replaced };
    }
    const line = `- [ ] ${task}${dueDate ? `（期限: ${dueDate}）` : ""}`;
    writeFileAtomic(file, insertIntoSection(content, headingOf(key), line));
    return { file, date: target, added: true, text: task, priority: key, due: dueDate, replaced };
  });
}

export function listTodos(home, { date } = {}) {
  readConfig(home);
  const target = date ? resolveDateInput(date) : formatDate();
  if (target === formatDate()) withLock(home, () => ensureTodo(home, target));
  const file = todoFile(home, target);
  const content = readText(file);
  const items = content ? parseTodo(content).items.filter((item) => item.status !== "carried").map(publicItem) : [];
  return {
    date: target,
    weekday: weekday(target),
    file,
    exists: content !== null,
    open: items.filter((item) => item.status === "open").length,
    done: items.filter((item) => item.status === "done").length,
    items,
  };
}

// Identify a task by its number (from todo list), by a unique text fragment,
// or — for the dashboard — by line number plus the exact text it expects to find there.
export function setTodoDone(home, { target, line, text, date, done = true } = {}) {
  readConfig(home);
  const day = date ? resolveDateInput(date) : formatDate();
  return withLock(home, () => {
    if (day === formatDate()) ensureTodo(home, day);
    const file = todoFile(home, day);
    const content = readText(file);
    if (content === null) throw new UserError(`${day} のTODOはありません。`);
    const parsed = parseTodo(content);
    const candidates = parsed.items.filter((item) => item.status !== "carried");
    let item;
    if (line !== undefined) {
      item = candidates.find((entry) => entry.line === line);
      if (!item || item.text !== text) throw new UserError("TODOが別の場所で更新されています。画面を読み込み直してください。");
    } else if (/^\d+$/.test(String(target ?? "").trim())) {
      item = candidates.find((entry) => entry.n === Number(target));
      if (!item) throw new UserError(`${target} 番のTODOはありません。todo list で番号を確認してください。`);
    } else {
      const query = oneLine(target, "対象のTODO（番号か文字）", 300);
      const wanted = done ? "open" : "done";
      const matches = candidates.filter((entry) => entry.status === wanted && entry.text.includes(query));
      if (matches.length === 0) throw new UserError(`「${query}」を含む${done ? "未完了" : "完了済み"}のTODOはありません。`);
      if (matches.length > 1) {
        throw new UserError(`「${query}」に当てはまるTODOが複数あります。番号で指定してください: ${matches.map((entry) => `${entry.n}. ${entry.text}`).join(" / ")}`);
      }
      [item] = matches;
    }
    const changed = (item.status === "done") !== done;
    if (changed) {
      parsed.lines[item.line] = parsed.lines[item.line].replace(ITEM_RE, `$1${done ? "x" : " "}$3$4`);
      writeFileAtomic(file, parsed.lines.join("\n"));
    }
    return { file, date: day, changed, item: publicItem({ ...item, status: done ? "done" : "open" }) };
  });
}

// Lookup by number or by a unique text fragment (used by todo drop and the pm commands).
function findItem(candidates, { target, wanted, label, hint }) {
  if (/^\d+$/.test(String(target ?? "").trim())) {
    const item = candidates.find((entry) => entry.n === Number(target));
    if (!item) throw new UserError(`${target} 番の${label}はありません。${hint} で番号を確認してください。`);
    if (wanted && item.status !== wanted) throw new UserError(`${target} 番の${label}は${item.status === "done" ? "完了済み" : "未完了"}です。`);
    return item;
  }
  const query = oneLine(target, `対象の${label}（番号か文字）`, 300);
  const matches = candidates.filter((entry) => (!wanted || entry.status === wanted) && entry.text.includes(query));
  const state = wanted === "open" ? "未完了の" : wanted === "done" ? "完了済みの" : "";
  if (matches.length === 0) throw new UserError(`「${query}」を含む${state}${label}はありません。`);
  if (matches.length > 1) {
    throw new UserError(`「${query}」に当てはまる${label}が複数あります。番号で指定してください: ${matches.map((entry) => `${entry.n}. ${entry.text}`).join(" / ")}`);
  }
  return matches[0];
}

// Removes an unfinished TODO without marking it done, and notes what was dropped (and why)
// in the memo section so the history stays readable.
export function dropTodo(home, { target, date, reason } = {}) {
  readConfig(home);
  const day = date ? resolveDateInput(date) : formatDate();
  const why = reason === undefined ? null : oneLine(reason, "理由（--reason）", 300);
  return withLock(home, () => {
    if (day === formatDate()) ensureTodo(home, day);
    const file = todoFile(home, day);
    const content = readText(file);
    if (content === null) throw new UserError(`${day} のTODOはありません。`);
    const parsed = parseTodo(content);
    const item = findItem(parsed.items.filter((entry) => entry.status !== "carried"), { target, wanted: "open", label: "TODO", hint: "todo list" });
    const rest = parsed.lines.filter((_, index) => index !== item.line).join("\n");
    writeFileAtomic(file, insertIntoSection(rest, NOTES_HEADING, `- ${formatTime()} 見送り: ${item.text}${why ? `（${why}）` : ""}`));
    return { file, date: day, dropped: publicItem(item), reason: why };
  });
}

// ---------- memos, decisions ----------

const MEMO_RE = /^-\s+(\d{1,2}:\d{2})\s+(.*)$/;

export function addMemo(home, { text, dept } = {}) {
  const config = readConfig(home);
  const body = oneLine(text, "メモの内容", 2000);
  let tag = "";
  if (dept) {
    const department = config.departments.find((entry) => entry.id === dept);
    if (!department) throw new UserError(`部署「${dept}」はまだありません。dept list で確認してください。`);
    tag = `[${department.name}] `;
  }
  return withLock(home, () => {
    const date = formatDate();
    const file = path.join(home, "inbox", `${date}.md`);
    const existing = readText(file) ?? `# メモ ${date}（${weekday(date)}）\n\n`;
    writeFileAtomic(file, `${existing}${existing.endsWith("\n") ? "" : "\n"}- ${formatTime()} ${tag}${body}\n`);
    return { file, added: true };
  });
}

export function addDecision(home, { title, decision, reason } = {}) {
  readConfig(home);
  const safeTitle = oneLine(title, "タイトル（--title）", 200);
  const safeDecision = oneLine(decision, "判断の内容（--decision）", 2000);
  const safeReason = reason ? oneLine(reason, "理由", 2000) : null;
  return withLock(home, () => {
    const date = formatDate();
    const month = date.slice(0, 7);
    const file = path.join(home, "decisions", `${month}.md`);
    const existing = readText(file) ?? `# 判断ログ ${month}\n`;
    const block = `\n## ${date} ${safeTitle}\n\n- **判断**: ${safeDecision}\n${safeReason ? `- **理由**: ${safeReason}\n` : ""}`;
    writeFileAtomic(file, `${existing.replace(/\n*$/, "\n")}${block}`);
    return { file, added: true };
  });
}

// ---------- departments ----------

function renderRules(department) {
  const known = DEPARTMENTS[department.id];
  const rules = [...(known?.rules ?? []), ...COMMON_RULES].map((rule) => `- ${rule}`).join("\n");
  const folders = (known?.folders ?? []).map((folder) => `- \`${folder}/\``).join("\n") || "- （必要に応じて作成）";
  return `# ${department.name}\n\n## 役割\n\n${department.role}\n\n## 保存ルール\n\n${rules}\n\n## フォルダ\n\n${folders}\n`;
}

export function addDepartment(home, { id, name, role } = {}) {
  readConfig(home);
  if (!validDepartmentId(id)) {
    throw new UserError("部署IDは半角の英小文字・数字・ハイフンで指定してください（例: research, side-project）。");
  }
  const known = DEPARTMENTS[id];
  const department = {
    id,
    name: name !== undefined ? oneLine(name, "部署名", 50) : known?.name ?? id,
    role: role !== undefined ? oneLine(role, "役割", 200) : known?.role ?? "カスタム部署",
    created: formatDate(),
  };
  return withLock(home, () => {
    const config = readConfig(home);
    const existing = config.departments.find((entry) => entry.id === id);
    const current = existing ?? department;
    const dir = path.join(home, "departments", id);
    for (const folder of known?.folders ?? []) fs.mkdirSync(path.join(dir, folder), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    const rulesFile = path.join(dir, "RULES.md");
    if (!fs.existsSync(rulesFile)) writeFileAtomic(rulesFile, renderRules(current));
    if (!existing) {
      config.departments.push(department);
      saveConfig(home, config);
    }
    return { created: !existing, department: current, dir, rulesFile };
  });
}

export function listDepartments(home) {
  const config = readConfig(home);
  return {
    departments: config.departments.map((department) => ({
      ...department,
      dir: path.join(home, "departments", department.id),
      files: listMarkdown(path.join(home, "departments", department.id)).filter((file) => file.path !== "RULES.md").length,
    })),
    available: Object.entries(DEPARTMENTS)
      .filter(([id]) => !config.departments.some((department) => department.id === id))
      .map(([id, definition]) => ({ id, name: definition.name, role: definition.role })),
  };
}

// ---------- reading helpers (also used by the dashboard) ----------

export function listMarkdown(base, { maxDepth = 6 } = {}) {
  const results = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        try {
          const stat = fs.statSync(full);
          results.push({ path: path.relative(base, full).split(path.sep).join("/"), full, mtime: stat.mtimeMs, size: stat.size });
        } catch {
          // The file vanished between readdir and stat.
        }
      }
    }
  };
  walk(base, 0);
  return results;
}

function titleOf(content, fallback) {
  return content.split(/\r?\n/).find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim() || fallback;
}

function isInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// Resolves a user-supplied relative path to a Markdown file inside `home`, or null.
export function readSafeMarkdown(home, requested) {
  if (typeof requested !== "string" || !requested || requested.length > 400 || requested.includes("\0")) return null;
  if (requested.split(/[\\/]/).some((segment) => segment.startsWith("."))) return null;
  const base = fs.realpathSync(home);
  const unresolved = path.resolve(base, requested);
  if (!isInside(base, unresolved) || path.extname(unresolved).toLowerCase() !== ".md") return null;
  let real;
  try {
    real = fs.realpathSync(unresolved);
  } catch {
    return null;
  }
  if (!isInside(base, real)) return null;
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size > MAX_MARKDOWN_BYTES) return null;
  const content = fs.readFileSync(real, "utf8");
  return { path: path.relative(base, real).split(path.sep).join("/"), title: titleOf(content, path.basename(real, ".md")), content };
}

export function departmentFiles(home, id) {
  const config = readConfig(home);
  const department = config.departments.find((entry) => entry.id === id);
  if (!department) return null;
  const base = path.join(home, "departments", id);
  const files = listMarkdown(base)
    .map((file) => {
      let title = path.basename(file.path, ".md");
      try {
        title = titleOf(fs.readFileSync(file.full, "utf8").slice(0, 4000), title);
      } catch {
        // Keep the filename as title.
      }
      return { path: `departments/${id}/${file.path}`, folder: file.path.includes("/") ? file.path.split("/")[0] : "", title, mtime: file.mtime, rules: file.path === "RULES.md" };
    })
    .sort((a, b) => Number(b.rules) - Number(a.rules) || b.mtime - a.mtime);
  return { department, files };
}

export function searchNotes(home, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return [];
  if (needle.length > 200) throw new UserError("検索語は200文字以内にしてください。");
  const results = [];
  for (const file of listMarkdown(home)) {
    if (file.size > MAX_MARKDOWN_BYTES) continue;
    let content;
    try {
      content = fs.readFileSync(file.full, "utf8");
    } catch {
      continue;
    }
    const nameHit = file.path.toLowerCase().includes(needle);
    const lines = content.split(/\r?\n/);
    const hits = [];
    for (let index = 0; index < lines.length && hits.length < 3; index += 1) {
      if (lines[index].toLowerCase().includes(needle)) hits.push({ line: index + 1, text: lines[index].trim().slice(0, 140) });
    }
    if (!nameHit && hits.length === 0) continue;
    results.push({ path: file.path, title: titleOf(content, path.basename(file.path, ".md")), hits, score: (nameHit ? 10 : 0) + hits.length, mtime: file.mtime });
  }
  return results.sort((a, b) => b.score - a.score || b.mtime - a.mtime).slice(0, 30);
}

function readMemos(home, date) {
  const content = readText(path.join(home, "inbox", `${date}.md`));
  if (!content) return [];
  return content.split(/\r?\n/).map((line) => line.match(MEMO_RE)).filter(Boolean).map((match) => ({ date, time: match[1], text: match[2] }));
}

function readDecisions(home, month) {
  const content = readText(path.join(home, "decisions", `${month}.md`));
  if (!content) return [];
  const decisions = [];
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (heading) decisions.push({ date: heading[1], title: heading[2], decision: "" });
    const body = line.match(/^-\s+\*\*判断\*\*:\s*(.+)$/);
    if (body && decisions.length) decisions.at(-1).decision = body[1];
  }
  return decisions;
}

// ---------- PM: projects, milestones, progress log, linked repositories ----------

const DUE_ANY = /（期限:\s*(\d{4}-\d{2}-\d{2})）/;
const MILESTONES_HEADING = "マイルストーン";
const PROGRESS_HEADING = "進捗ログ";
const projectsDir = (home) => path.join(home, "departments", "pm", "projects");

function projectIds(home) {
  try {
    return fs.readdirSync(projectsDir(home)).filter((name) => name.endsWith(".md")).map((name) => path.basename(name, ".md")).sort();
  } catch {
    return [];
  }
}

function projectFile(home, project) {
  if (!validDepartmentId(project)) throw new UserError("プロジェクトIDは英小文字・数字・ハイフンで指定してください（pm list で確認できます）。");
  const file = path.join(projectsDir(home), `${project}.md`);
  if (!fs.existsSync(file)) throw new UserError(`プロジェクト「${project}」はありません（departments/pm/projects/${project}.md）。pm list で確認してください。`);
  return file;
}

// Milestones are checklist lines anywhere in a project file. The due date may be followed by notes.
export function parseMilestones(content) {
  const lines = content.split(/\r?\n/);
  const items = [];
  let section = null;
  let number = 0;
  lines.forEach((line, index) => {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1];
      return;
    }
    const match = line.match(ITEM_RE);
    if (!match || match[2] === ">") return;
    items.push({
      n: ++number,
      line: index,
      section,
      status: match[2] === " " ? "open" : "done",
      text: match[4].replace(DUE_ANY, " ").replace(/\s+/g, " ").trim(),
      due: match[4].match(DUE_ANY)?.[1] ?? null,
    });
  });
  return { lines, items };
}

const publicMilestone = ({ n, section, status, text, due }) => ({ n, section, status, text, due });

// Open milestones from pm/projects/*.md, written as `- [ ] text（期限: YYYY-MM-DD）`.
export function upcomingMilestones(home, { date = formatDate(), days = 7 } = {}) {
  const until = addDays(date, days);
  const milestones = [];
  for (const id of projectIds(home)) {
    const content = readText(path.join(projectsDir(home), `${id}.md`)) ?? "";
    const project = titleOf(content, id);
    for (const item of parseMilestones(content).items) {
      if (item.status === "open" && item.due && item.due <= until) {
        milestones.push({ project, file: `departments/pm/projects/${id}.md`, text: item.text, due: item.due, overdue: item.due < date });
      }
    }
  }
  return milestones.sort((a, b) => a.due.localeCompare(b.due));
}

export function listProjects(home, { project } = {}) {
  const config = readConfig(home);
  if (project) {
    const file = projectFile(home, project);
    const content = fs.readFileSync(file, "utf8");
    return {
      project,
      title: titleOf(content, project),
      file,
      repo: config.repos?.[project] ?? null,
      milestones: parseMilestones(content).items.map(publicMilestone),
    };
  }
  const projects = projectIds(home).map((id) => {
    const content = readText(path.join(projectsDir(home), `${id}.md`)) ?? "";
    const items = parseMilestones(content).items;
    const next = items.filter((item) => item.status === "open" && item.due).sort((a, b) => a.due.localeCompare(b.due))[0];
    return {
      project: id,
      title: titleOf(content, id),
      open: items.filter((item) => item.status === "open").length,
      done: items.filter((item) => item.status === "done").length,
      next: next ? publicMilestone(next) : null,
      repo: config.repos?.[id] ?? null,
    };
  });
  return { projects };
}

// Range [start, end) of the lines under a `##`/`###` heading, ending at the next heading of the
// same or a higher level.
function sectionRange(lines, title, level, from = 0, to = lines.length) {
  const marker = `${"#".repeat(level)} ${title}`;
  const start = lines.findIndex((line, index) => index >= from && index < to && line.trim() === marker);
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && index < to && new RegExp(`^#{1,${level}}\\s`).test(line));
  if (end < 0) end = to;
  return { start, end };
}

function appendInRange(lines, { start, end }, newLine) {
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at -= 1;
  lines.splice(at, 0, newLine);
  if (lines[at + 1] !== undefined && /^#{1,6}\s/.test(lines[at + 1])) lines.splice(at + 1, 0, "");
}

function ensureSection(lines, title, level, { before, from = 0, to = lines.length } = {}) {
  const found = sectionRange(lines, title, level, from, to);
  if (found) return found;
  let at = to;
  if (before) {
    const next = lines.findIndex((line, index) => index >= from && index < to && line.trim() === before);
    if (next >= 0) at = next;
  }
  while (at > from && !lines[at - 1].trim()) at -= 1;
  lines.splice(at, 0, "", `${"#".repeat(level)} ${title}`, "");
  return sectionRange(lines, title, level, from, to + 3);
}

export function addMilestone(home, { project, text, due, section } = {}) {
  readConfig(home);
  const task = oneLine(text, "マイルストーンの内容", 300).replace(DUE_ANY, "").trim();
  if (!due) throw new UserError("マイルストーンには期限が必要です（--due YYYY-MM-DD）。");
  const dueDate = resolveDateInput(due, "期限");
  const sub = section === undefined ? null : oneLine(section, "小見出し（--section）", 100);
  return withLock(home, () => {
    const file = projectFile(home, project);
    const content = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    const existing = parseMilestones(content).items.find((item) => item.status === "open" && item.text === task);
    if (existing) return { file, added: false, reason: "同じマイルストーンがすでにあります", milestone: publicMilestone(existing) };
    const lines = content.split("\n");
    let range = ensureSection(lines, MILESTONES_HEADING, 2, { before: `## ${PROGRESS_HEADING}` });
    if (sub) range = ensureSection(lines, sub, 3, { from: range.start + 1, to: range.end });
    appendInRange(lines, range, `- [ ] ${task}（期限: ${dueDate}）`);
    writeFileAtomic(file, `${lines.join("\n")}\n`);
    return { file, added: true, text: task, due: dueDate, section: sub ?? MILESTONES_HEADING };
  });
}

export function setMilestoneDone(home, { project, target, done = true } = {}) {
  readConfig(home);
  return withLock(home, () => {
    const file = projectFile(home, project);
    const parsed = parseMilestones(fs.readFileSync(file, "utf8"));
    const item = findItem(parsed.items, { target, wanted: done ? "open" : "done", label: "マイルストーン", hint: "pm list <プロジェクトID>" });
    parsed.lines[item.line] = parsed.lines[item.line].replace(ITEM_RE, `$1${done ? "x" : " "}$3$4`);
    writeFileAtomic(file, parsed.lines.join("\n"));
    return { file, milestone: publicMilestone({ ...item, status: done ? "done" : "open" }) };
  });
}

export function setMilestoneDue(home, { project, target, due } = {}) {
  readConfig(home);
  if (!due) throw new UserError("新しい期限を --due で指定してください。");
  const dueDate = resolveDateInput(due, "期限");
  return withLock(home, () => {
    const file = projectFile(home, project);
    const parsed = parseMilestones(fs.readFileSync(file, "utf8"));
    const item = findItem(parsed.items, { target, wanted: "open", label: "マイルストーン", hint: "pm list <プロジェクトID>" });
    const line = parsed.lines[item.line];
    parsed.lines[item.line] = DUE_ANY.test(line) ? line.replace(DUE_ANY, `（期限: ${dueDate}）`) : `${line.replace(/\s+$/, "")}（期限: ${dueDate}）`;
    writeFileAtomic(file, parsed.lines.join("\n"));
    return { file, milestone: publicMilestone({ ...item, due: dueDate }), from: item.due, to: dueDate };
  });
}

export function addProgressLog(home, { project, text } = {}) {
  readConfig(home);
  const body = oneLine(text, "進捗の内容", 2000);
  return withLock(home, () => {
    const file = projectFile(home, project);
    const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
    const range = ensureSection(lines, PROGRESS_HEADING, 2);
    const line = `- ${formatDate()}: ${body}`;
    appendInRange(lines, range, line);
    writeFileAtomic(file, `${lines.join("\n")}\n`);
    return { file, added: true, line };
  });
}

export function linkRepo(home, { project, repo } = {}) {
  readConfig(home);
  const folder = path.resolve(oneLine(repo, "リポジトリのフォルダ（--repo）", 500));
  if (!fs.existsSync(path.join(folder, ".git"))) throw new UserError(`「${folder}」は git のリポジトリではありません（.git がありません）。`);
  return withLock(home, () => {
    projectFile(home, project);
    const config = readConfig(home);
    config.repos = { ...(config.repos ?? {}), [project]: folder };
    saveConfig(home, config);
    return { project, repo: folder };
  });
}

// "…ユーザーへ" (handed to the user) or "…待ち" (waiting); "ユーザーの答え" means it was already answered.
const WAITING_RE = /(待ち|仰ぐ|ユーザーへ)/;

// Recent commits of linked repositories (read-only `git log`). Subjects that mention the user
// together with waiting/confirmation words are surfaced as "waiting on you".
export function devActivity(home, { hours = 36 } = {}) {
  const config = readConfig(home);
  const span = Number(hours);
  if (!Number.isFinite(span) || span <= 0 || span > 24 * 31) throw new UserError("--hours は 1〜744 の数で指定してください。");
  return Object.entries(config.repos ?? {}).map(([project, repo]) => {
    const result = spawnSync("git", ["-C", repo, "log", `--since=${span} hours ago`, "--pretty=format:%ad%x09%s", "--date=format:%m/%d %H:%M", "-n", "200"], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      return { project, repo, error: (result.error?.message ?? result.stderr ?? "git log に失敗しました").trim().slice(0, 300), commits: [], waiting: [] };
    }
    const commits = result.stdout.split("\n").filter(Boolean).map((line) => {
      const [at, ...rest] = line.split("\t");
      return { at, subject: rest.join("\t") };
    });
    const waiting = commits.filter((commit) => commit.subject.includes("ユーザー") && WAITING_RE.test(commit.subject));
    return { project, repo, hours: span, commits, waiting };
  });
}

// ---------- research: idea records (idea-check) ----------

function frontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*(#.*)?$/);
    if (pair) data[pair[1]] = pair[2].replace(/^"(.*)"$/, "$1");
  }
  return data;
}

export function listIdeas(home) {
  const dir = path.join(home, "departments", "research", "ideas");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const content = readText(path.join(dir, name)) ?? "";
      const meta = frontmatter(content);
      const stage = Number.parseInt(meta.stage, 10);
      return {
        id: path.basename(name, ".md"),
        name: meta.name || titleOf(content, path.basename(name, ".md")),
        status: meta.status || null,
        stage: Number.isFinite(stage) ? stage : null,
        updated: meta.updated || null,
        path: `departments/research/ideas/${name}`,
      };
    })
    .sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")));
}

function previousMonth(date) {
  const [y, m] = date.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// ---------- status, brief, doctor ----------

export function status(home) {
  if (!isInitialized(home)) {
    return { initialized: false, home, message: "まだ初期化されていません。事業・活動と目標を聞いてから init を実行してください。" };
  }
  const config = readConfig(home);
  const date = formatDate();
  const content = readText(todoFile(home, date));
  const items = content ? parseTodo(content).items.filter((item) => item.status !== "carried") : [];
  return {
    initialized: true,
    version: VERSION,
    home,
    date,
    weekday: weekday(date),
    owner: config.owner,
    todo: { exists: content !== null, open: items.filter((item) => item.status === "open").length, done: items.filter((item) => item.status === "done").length },
    departments: config.departments.map((department) => ({ id: department.id, name: department.name })),
    milestones: upcomingMilestones(home, { date }),
    briefSaved: fs.existsSync(path.join(home, "briefs", `${date}.md`)),
  };
}

export function buildBrief(home, { date, save = false } = {}) {
  const config = readConfig(home);
  const target = date ? resolveDateInput(date) : formatDate();
  return withLock(home, () => {
    const { carried } = target === formatDate() ? ensureTodo(home, target) : { carried: [] };
    const content = readText(todoFile(home, target));
    const items = content ? parseTodo(content).items.filter((item) => item.status !== "carried") : [];
    const open = items.filter((item) => item.status === "open");
    const overdue = open.filter((item) => item.due && item.due < target);
    const dueSoon = open.filter((item) => item.due && item.due >= target && daysBetween(target, item.due) <= 3);

    const previousDate = listTodoDates(home).filter((candidate) => candidate < target).at(-1) ?? null;
    let previous = null;
    if (previousDate) {
      const previousItems = parseTodo(fs.readFileSync(todoFile(home, previousDate), "utf8")).items;
      previous = {
        date: previousDate,
        done: previousItems.filter((item) => item.status === "done").length,
        carried: previousItems.filter((item) => item.status === "carried").length,
      };
    }
    const memos = [addDays(target, -2), addDays(target, -1), target].flatMap((day) => readMemos(home, day));

    const lines = [`# おはようございます — ${target}（${weekday(target)}）`, "", `**${config.owner.business}** ／ 目標: ${config.owner.goals}`, ""];
    lines.push(`## 今日のTODO（未完了 ${open.length}件）`, "");
    if (open.length === 0) lines.push("- 未完了のTODOはありません。", "");
    for (const priority of PRIORITIES) {
      const group = open.filter((item) => item.priority === priority.key);
      if (!group.length) continue;
      lines.push(`### ${priority.heading}`, ...group.map((item) => `- [ ] ${item.text}${item.due ? `（期限: ${item.due}）` : ""}`), "");
    }
    if (overdue.length || dueSoon.length) {
      lines.push("## 期限に注意", "");
      for (const item of overdue) lines.push(`- **期限切れ**（${daysBetween(item.due, target)}日超過）: ${item.text}`);
      for (const item of dueSoon) {
        const left = daysBetween(target, item.due);
        lines.push(`- ${left === 0 ? "**今日まで**" : `あと${left}日`}: ${item.text}`);
      }
      lines.push("");
    }
    const milestones = upcomingMilestones(home, { date: target });
    if (milestones.length) {
      lines.push("## プロジェクトの予定（7日以内）", "");
      for (const milestone of milestones) {
        const left = daysBetween(target, milestone.due);
        const when = left < 0 ? `**期限切れ**（${-left}日超過）` : left === 0 ? "**今日まで**" : `あと${left}日（${milestone.due}）`;
        lines.push(`- ${when}: ${milestone.project} — ${milestone.text}`);
      }
      lines.push("");
    }
    const dev = config.repos ? devActivity(home, { hours: 36 }) : [];
    if (dev.length) {
      lines.push("## 開発の動き（直近36時間）", "");
      for (const entry of dev) {
        if (entry.error) {
          lines.push(`- ${entry.project}: 読み取れませんでした（${entry.error}）`);
          continue;
        }
        const latest = entry.commits[0];
        lines.push(`- ${entry.project}: コミット ${entry.commits.length}件${latest ? `（最新 ${latest.at}: ${latest.subject}）` : ""}`);
        for (const commit of entry.waiting.slice(0, 3)) lines.push(`  - **あなたの確認待ちかもしれません**: ${commit.at} ${commit.subject}`);
      }
      lines.push("");
    }
    if (previous) {
      lines.push(`## 前回（${previous.date}）の振り返り`, "", `- 完了 ${previous.done}件 ／ 今日へ繰り越し ${previous.carried}件`, "");
    }
    if (memos.length) {
      lines.push(`## 未整理のメモ（直近3日: ${memos.length}件）`, "");
      for (const memo of memos.slice(-5).reverse()) lines.push(`- ${memo.date.slice(5)} ${memo.time} ${memo.text}`);
      lines.push("");
    }
    const markdown = `${lines.join("\n").replace(/\n+$/, "")}\n`;
    let file = null;
    if (save) {
      file = path.join(home, "briefs", `${target}.md`);
      writeFileAtomic(file, markdown);
    }
    return {
      date: target,
      file,
      carriedNow: carried.length,
      open: open.length,
      done: items.length - open.length,
      overdue: overdue.map(publicItem),
      dueSoon: dueSoon.map(publicItem),
      previous,
      memos: memos.length,
      milestones,
      dev,
      markdown,
    };
  });
}

export function doctor(home) {
  const issues = [];
  if (!fs.existsSync(home)) {
    return { ok: false, home, issues: [{ level: "error", message: "データフォルダがありません。init を実行してください。" }] };
  }
  let config;
  try {
    config = readConfig(home);
  } catch (error) {
    return { ok: false, home, issues: [{ level: "error", message: error.message }] };
  }
  for (const dir of BASE_DIRS) {
    if (!fs.existsSync(path.join(home, dir))) issues.push({ level: "warning", message: `${dir}/ フォルダがありません（次の書き込みで自動作成されます）。` });
  }
  const registered = new Set(config.departments.map((department) => department.id));
  for (const department of config.departments) {
    const dir = path.join(home, "departments", department.id);
    if (!fs.existsSync(path.join(dir, "RULES.md"))) {
      issues.push({ level: "warning", message: `部署「${department.name}」の RULES.md がありません。dept add ${department.id} で作り直せます。` });
    }
  }
  try {
    for (const entry of fs.readdirSync(path.join(home, "departments"), { withFileTypes: true })) {
      if (entry.isDirectory() && !registered.has(entry.name)) {
        issues.push({ level: "info", message: `departments/${entry.name}/ は config.json に登録されていません。` });
      }
    }
  } catch {
    // Reported above as a missing base directory.
  }
  const lockPath = path.join(home, LOCK_FILE);
  if (fs.existsSync(lockPath) && Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
    issues.push({ level: "warning", message: "古いロックファイル（.lock）が残っています。次の書き込み時に自動で解除されます。" });
  }
  return { ok: !issues.some((issue) => issue.level === "error"), home, issues };
}

// ---------- analytics: bucket metrics ----------

const METRIC_ID = /^[a-z][a-z0-9_]{0,39}$/;
const METRIC_UNITS = { count: "人・件", percent: "%", yen: "円" };
const PERIOD_RE = /^(\d{4})-W(\d{2})$/;
const analyticsAppsDir = (home) => path.join(home, "departments", "analytics", "apps");
const metricsPath = (home, app) => path.join(analyticsAppsDir(home), app, "metrics.json");

// ISO week (Monday start) that contains `date`.
export function weekOf(date = formatDate()) {
  const day = parseDate(date);
  const weekday = (day.getDay() + 6) % 7;
  const start = addDays(date, -weekday);
  const thursday = parseDate(addDays(start, 3));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday - firstThursday) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return { period: `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`, start, end: addDays(start, 6) };
}

function periodRange(period) {
  const match = String(period ?? "").match(PERIOD_RE);
  if (!match) throw new UserError("期間は 2026-W40 のような ISO 週で指定してください。");
  const jan4 = formatDate(new Date(Number(match[1]), 0, 4));
  const start = addDays(weekOf(jan4).start, (Number(match[2]) - 1) * 7);
  if (weekOf(start).period !== period) throw new UserError(`期間「${period}」は存在しない週です。`);
  return { period, start, end: addDays(start, 6) };
}

function validateMetrics(data, app) {
  const fail = (message) => { throw new UserError(`${app} の metrics.json: ${message}`); };
  if (!data || typeof data !== "object" || !Array.isArray(data.metrics)) fail("metrics（指標の配列）がありません。");
  const ids = new Map();
  for (const metric of data.metrics) {
    if (!METRIC_ID.test(metric?.id ?? "")) fail(`指標IDは英小文字・数字・_ で書いてください: ${JSON.stringify(metric?.id)}`);
    if (ids.has(metric.id)) fail(`指標ID ${metric.id} が重複しています。`);
    if (typeof metric.label !== "string" || !METRIC_UNITS[metric.unit]) fail(`${metric.id} の label か unit（count / percent / yen）が不正です。`);
    ids.set(metric.id, metric);
  }
  for (const funnel of data.funnels ?? []) {
    if (typeof funnel?.label !== "string" || !Array.isArray(funnel.steps) || funnel.steps.length < 2) fail("funnels の各要素には label と2つ以上の steps が必要です。");
    for (const step of funnel.steps) {
      if (ids.get(step)?.unit !== "count") fail(`ファネル「${funnel.label}」の ${step} は、定義済みの人数（count）の指標にしてください。`);
    }
  }
  if (!Array.isArray(data.snapshots)) data.snapshots = [];
  return data;
}

export function listMetricApps(home) {
  let entries = [];
  try {
    entries = fs.readdirSync(analyticsAppsDir(home), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && fs.existsSync(metricsPath(home, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

export function readMetrics(home, app) {
  if (!validDepartmentId(app)) throw new UserError("アプリIDは英小文字・数字・ハイフンで指定してください。");
  const content = readText(metricsPath(home, app));
  if (content === null) throw new UserError(`「${app}」の指標がまだ定義されていません（departments/analytics/apps/${app}/metrics.json）。`);
  let data;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new UserError(`${app} の metrics.json を読み込めません: ${error.message}`);
  }
  return validateMetrics(data, app);
}

// Upserts one week's values. `values` maps metric id → number; unknown ids are rejected.
export function recordSnapshot(home, app, { period, values, note } = {}) {
  readConfig(home);
  const range = period ? periodRange(period) : weekOf();
  const metrics = new Map(readMetrics(home, app).metrics.map((metric) => [metric.id, metric]));
  if (!values || typeof values !== "object" || !Object.keys(values).length) throw new UserError("記録する数字（values）がありません。");
  const clean = {};
  for (const [id, raw] of Object.entries(values)) {
    const metric = metrics.get(id);
    if (!metric) throw new UserError(`指標「${id}」は定義されていません。定義済み: ${[...metrics.keys()].join(", ")}`);
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new UserError(`${metric.label}（${id}）には0以上の数字を入れてください。`);
    if (metric.unit === "percent" && value > 100) throw new UserError(`${metric.label}（${id}）は0〜100の割合で入れてください。`);
    clean[id] = Math.round(value * 100) / 100;
  }
  const safeNote = note ? oneLine(note, "メモ", 500) : undefined;
  return withLock(home, () => {
    const data = readMetrics(home, app);
    let snapshot = data.snapshots.find((entry) => entry.period === range.period);
    if (!snapshot) {
      snapshot = { period: range.period, start: range.start, end: range.end, values: {} };
      data.snapshots.push(snapshot);
    }
    Object.assign(snapshot.values, clean);
    snapshot.recordedAt = new Date().toISOString();
    if (safeNote) snapshot.note = safeNote;
    data.snapshots.sort((a, b) => a.period.localeCompare(b.period));
    writeFileAtomic(metricsPath(home, app), `${JSON.stringify(data, null, 2)}\n`);
    return { app, file: metricsPath(home, app), snapshot };
  });
}

function activeExperiments(home, app) {
  const content = readText(path.join(analyticsAppsDir(home), app, "experiments.md"));
  if (!content) return [];
  const titles = [];
  let inActive = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) inActive = /^##\s+実施中/.test(line);
    else if (inActive && /^###\s+/.test(line)) titles.push(line.replace(/^###\s+/, "").trim());
  }
  return titles;
}

// Latest (or given) week vs the week before: metric changes, funnel conversions and the biggest leak.
export function summarizeMetrics(home, app, { period } = {}) {
  const data = readMetrics(home, app);
  const snapshots = data.snapshots;
  const index = period ? snapshots.findIndex((entry) => entry.period === period) : snapshots.length - 1;
  if (period && index < 0) throw new UserError(`${app} には ${period} の記録がありません。`);
  const current = snapshots[index] ?? null;
  const previous = index > 0 ? snapshots[index - 1] : null;
  const round1 = (value) => Math.round(value * 10) / 10;
  const metricById = new Map(data.metrics.map((metric) => [metric.id, metric]));
  const metrics = data.metrics.map((metric) => {
    const value = current?.values[metric.id] ?? null;
    const before = previous?.values[metric.id] ?? null;
    let change = null;
    if (value !== null && before !== null) {
      change = metric.unit === "percent"
        ? { type: "pt", value: round1(value - before) }
        : before > 0 ? { type: "percent", value: round1(((value - before) / before) * 100) } : null;
    }
    const target = typeof metric.target === "number" ? metric.target : null;
    return { ...metric, value, previous: before, change, target, belowTarget: target !== null && value !== null ? value < target : null };
  });
  const funnels = (data.funnels ?? []).map((funnel) => {
    const steps = funnel.steps.map((id, stepIndex) => {
      const value = current?.values[id] ?? null;
      const prior = stepIndex > 0 ? current?.values[funnel.steps[stepIndex - 1]] ?? null : null;
      const priorBefore = stepIndex > 0 ? previous?.values[funnel.steps[stepIndex - 1]] ?? null : null;
      const before = previous?.values[id] ?? null;
      const conversion = value !== null && prior ? round1((value / prior) * 100) : null;
      const previousConversion = before !== null && priorBefore ? round1((before / priorBefore) * 100) : null;
      return { id, label: metricById.get(id).label, stage: metricById.get(id).stage ?? null, value, conversion, previousConversion };
    });
    return { label: funnel.label, steps };
  });
  const transitions = funnels.flatMap((funnel) => funnel.steps
    .map((step, stepIndex) => (stepIndex > 0 && step.conversion !== null ? { funnel: funnel.label, from: funnel.steps[stepIndex - 1].label, to: step.label, conversion: step.conversion, previousConversion: step.previousConversion } : null))
    .filter(Boolean));
  const biggestLeak = [...transitions].sort((a, b) => a.conversion - b.conversion)[0] ?? null;
  const worsened = transitions
    .filter((step) => step.previousConversion !== null && step.conversion < step.previousConversion)
    .map((step) => ({ ...step, drop: round1(step.previousConversion - step.conversion) }))
    .sort((a, b) => b.drop - a.drop);
  return {
    app,
    name: data.name ?? app,
    period: current?.period ?? null,
    range: current ? { start: current.start, end: current.end } : null,
    previousPeriod: previous?.period ?? null,
    note: current?.note ?? null,
    metrics,
    funnels,
    biggestLeak,
    worsened,
    experiments: activeExperiments(home, app),
    weeks: snapshots.length,
  };
}

export function analyticsState(home) {
  return listMetricApps(home).map((app) => {
    try {
      return summarizeMetrics(home, app);
    } catch (error) {
      return { app, error: error instanceof UserError ? error.message : "読み込めませんでした" };
    }
  });
}

export function dashboardState(home) {
  const config = readConfig(home);
  const date = formatDate();
  withLock(home, () => ensureTodo(home, date));
  const items = parseTodo(readText(todoFile(home, date)) ?? "").items.filter((item) => item.status !== "carried").map(publicItem);
  const week = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const day = addDays(date, offset);
    const content = readText(todoFile(home, day));
    const dayItems = content ? parseTodo(content).items : [];
    week.push({ date: day, weekday: weekday(day), done: dayItems.filter((item) => item.status === "done").length });
  }
  const memos = [addDays(date, -1), date].flatMap((day) => readMemos(home, day)).reverse().slice(0, 12);
  const month = date.slice(0, 7);
  const decisions = [...readDecisions(home, previousMonth(date)), ...readDecisions(home, month)].reverse().slice(0, 6);
  const files = listMarkdown(home);
  const departments = config.departments.map((department) => {
    const own = files.filter((file) => file.path.startsWith(`departments/${department.id}/`) && !file.path.endsWith("/RULES.md"));
    return { ...department, files: own.length, updated: own.length ? Math.max(...own.map((file) => file.mtime)) : null, rules: `departments/${department.id}/RULES.md` };
  });
  const recent = [...files]
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 15)
    .map((file) => {
      let title = path.basename(file.path, ".md");
      try {
        title = titleOf(fs.readFileSync(file.full, "utf8").slice(0, 4000), title);
      } catch {
        // Keep the filename as title.
      }
      return { path: file.path, title, mtime: file.mtime };
    });
  const briefPath = `briefs/${date}.md`;
  return {
    version: VERSION,
    date,
    weekday: weekday(date),
    owner: config.owner,
    todo: { path: `todos/${date}.md`, items },
    milestones: upcomingMilestones(home, { date, days: 14 }),
    analytics: analyticsState(home),
    ideas: listIdeas(home),
    week,
    memos,
    decisions,
    departments,
    recent,
    brief: fs.existsSync(path.join(home, briefPath)) ? briefPath : null,
  };
}
