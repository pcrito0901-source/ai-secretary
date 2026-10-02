#!/usr/bin/env node
// Marketing department CLI: app profiles, the SNS post log, tracking links, weekly ranges.
// Data lives in <AI秘書 home>/departments/marketing/.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// The secretary skill's scripts are found next to this skill in both layouts: a clone of the
// repository (departments/<skill>/scripts → ../../../secretary) and an installed skills folder
// where each skill is a sibling (~/.claude/skills/<skill>/scripts → ../../secretary).
const secretaryScripts = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.AI_SECRETARY_SCRIPTS,
    path.join(here, "..", "..", "..", "secretary", "scripts"),
    path.join(here, "..", "..", "secretary", "scripts"),
  ].filter(Boolean);
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, "lib.mjs")));
  if (!found) throw new Error("AI秘書の本体（secretary スキル）が見つかりません。secretary を同じ skills フォルダに入れてください。");
  return found;
})();
const lib = await import(pathToFileURL(path.join(secretaryScripts, "lib.mjs")).href);
const { parseArgs } = await import(pathToFileURL(path.join(secretaryScripts, "secretary.mjs")).href);

const marketingDir = (home) => path.join(home, "departments", "marketing");
const appsDir = (home) => path.join(marketingDir(home), "apps");
const logFile = (home) => path.join(marketingDir(home), "post-log.md");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const STAGES = { prelaunch: "公開前", live: "公開後" };
const CHANNELS = {
  tiktok: "tiktok", "ティックトック": "tiktok",
  instagram: "instagram", insta: "instagram", ig: "instagram", reels: "instagram", "インスタ": "instagram", "リール": "instagram",
  youtube: "youtube", shorts: "youtube", yt: "youtube", "ショート": "youtube",
  x: "x", twitter: "x",
  threads: "threads",
  note: "note",
  other: "other",
};
const METRICS = [
  ["views", "再生"],
  ["likes", "いいね"],
  ["saves", "保存"],
  ["pageViews", "ページ訪問"],
  ["installs", "インストール"],
];
const COLUMNS = ["ID", "日付", "アプリ", "チャネル", "形式", "フック", ...METRICS.map(([, label]) => label), "ct", "メモ"];

function requireMarketing(home) {
  const config = lib.readConfig(home);
  if (!config.departments.some((department) => department.id === "marketing")) {
    throw new lib.UserError("マーケティング部がまだありません。先に secretary の `dept add marketing` を実行してください。");
  }
}

// ---------- apps ----------

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const data = {};
  if (!match) return { data, body: content };
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z][\w]*):\s*(.*)$/);
    if (pair) data[pair[1]] = pair[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return { data, body: content.slice(match[0].length) };
}

function renderFrontmatter(data) {
  const lines = Object.entries(data).map(([key, value]) => `${key}: "${String(value ?? "").replace(/"/g, "'")}"`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function appTemplate(name) {
  const sections = [
    "一言でいうと",
    "誰のためのアプリか（ターゲット）",
    "ユーザーの悩み・やりたいこと",
    "主な機能と、使うと得られること",
    "競合と違い（競合アプリ名と App Store ID）",
    "料金・収益化（無料体験・プラン・価格）",
    "ブランドの口調・使わない表現",
    "SNSアカウントとチャネル",
    "公開予定日と事前登録の受け皿（予約注文・TestFlight・事前登録ページ）",
    "目標とKPI",
    "分かっていること・仮説（随時追記）",
  ];
  return `# ${name} — マーケティングの前提\n\n${sections.map((section) => `## ${section}\n\n（未記入）\n`).join("\n")}`;
}

export function listApps(home) {
  requireMarketing(home);
  let names = [];
  try {
    names = fs.readdirSync(appsDir(home)).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  return names.sort().map((name) => {
    const file = path.join(appsDir(home), name);
    const { data, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
    const unfilled = (body.match(/（未記入）/g) || []).length;
    return {
      slug: path.basename(name, ".md"),
      name: data.name || path.basename(name, ".md"),
      stage: STAGES[data.stage] ? data.stage : "prelaunch",
      stageLabel: STAGES[data.stage] ?? STAGES.prelaunch,
      appStoreId: data.appStoreId || "",
      country: data.country || "jp",
      providerToken: data.providerToken || "",
      file,
      unfilledSections: unfilled,
    };
  });
}

function getApp(home, slug) {
  const apps = listApps(home);
  if (!slug) {
    if (apps.length === 1) return apps[0];
    if (apps.length === 0) throw new lib.UserError("アプリがまだ登録されていません。`app init <アプリID> --name <名前>` で登録してください。");
    throw new lib.UserError(`アプリが複数あります。--app で指定してください: ${apps.map((app) => app.slug).join(", ")}`);
  }
  const app = apps.find((entry) => entry.slug === slug);
  if (!app) throw new lib.UserError(`アプリ「${slug}」は登録されていません。登録済み: ${apps.map((entry) => entry.slug).join(", ") || "なし"}`);
  return app;
}

function validateStoreFields({ appStoreId, country, providerToken, stage }) {
  if (stage !== undefined && !STAGES[stage]) throw new lib.UserError("--stage は prelaunch（公開前）か live（公開後）で指定してください。");
  if (appStoreId !== undefined && appStoreId !== "" && !/^\d{6,12}$/.test(appStoreId)) throw new lib.UserError("App Store ID は数字だけで指定してください（URLの id の後ろの数字）。");
  if (country !== undefined && !/^[a-z]{2}$/.test(country)) throw new lib.UserError("国コードは jp, us のような英小文字2文字で指定してください。");
  if (providerToken !== undefined && providerToken !== "" && !/^\d{3,12}$/.test(providerToken)) throw new lib.UserError("providerToken（pt）は数字で指定してください。App Store Connect のキャンペーンリンク作成画面の URL にある pt= の値です。");
}

export function initApp(home, { slug, name, appStoreId = "", country = "jp", providerToken = "", stage = "prelaunch" }) {
  requireMarketing(home);
  if (!SLUG_RE.test(slug ?? "")) throw new lib.UserError("アプリIDは英小文字・数字・ハイフンで指定してください（例: habit-app）。");
  const appName = lib.oneLine(name, "アプリ名（--name）", 60);
  validateStoreFields({ appStoreId, country, providerToken, stage });
  return lib.withLock(home, () => {
    const file = path.join(appsDir(home), `${slug}.md`);
    if (fs.existsSync(file)) return { created: false, file, message: "すでに登録されています。内容はファイルを直接編集してください。" };
    lib.writeFileAtomic(file, `${renderFrontmatter({ name: appName, stage, appStoreId, country, providerToken })}\n${appTemplate(appName)}`);
    return { created: true, file, stage };
  });
}

export function setApp(home, { slug, name, appStoreId, country, providerToken, stage }) {
  const app = getApp(home, slug);
  validateStoreFields({ appStoreId, country, providerToken, stage });
  return lib.withLock(home, () => {
    const { data, body } = parseFrontmatter(fs.readFileSync(app.file, "utf8"));
    if (name !== undefined) data.name = lib.oneLine(name, "アプリ名", 60);
    if (stage !== undefined) data.stage = stage;
    if (appStoreId !== undefined) data.appStoreId = appStoreId;
    if (country !== undefined) data.country = country;
    if (providerToken !== undefined) data.providerToken = providerToken;
    lib.writeFileAtomic(app.file, `${renderFrontmatter(data)}${body.startsWith("\n") ? "" : "\n"}${body}`);
    return { file: app.file, ...data };
  });
}

// ---------- tracking links ----------

export function trackingLink(app, campaign) {
  if (!app.appStoreId) {
    return {
      link: null,
      warning: app.stage === "prelaunch"
        ? "公開前で App Store ID が未設定です。ベータ参加ページや事前登録ページのURLを使い、この投稿の ct 名を控えておいてください。"
        : "App Store ID が未設定のためリンクを作れません。`app set --app-store-id` で登録してください。",
    };
  }
  const params = new URLSearchParams();
  if (app.providerToken) params.set("pt", app.providerToken);
  params.set("ct", campaign);
  const link = `https://apps.apple.com/${app.country}/app/id${app.appStoreId}?${params}`;
  const warnings = [];
  if (app.stage === "prelaunch") warnings.push("公開前のため、予約注文を始めるまでこのリンクは開けません。");
  if (!app.providerToken) warnings.push("providerToken（pt）が未設定のため、App Store Connect で流入元として集計されません。App Store Connect → アプリ分析 → キャンペーンで pt を確認し、`app set --provider-token` で登録してください。");
  return { link, warning: warnings.join(" ") || null };
}

function campaignName(value) {
  const campaign = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(campaign)) throw new lib.UserError("キャンペーン名（ct）は英数字と . _ - で40文字以内にしてください。");
  return campaign;
}

// ---------- post log ----------

// Accepts 1234, 1,234, 1.2万, 3k, 2.5m.
export function parseCount(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().replace(/,/g, "").toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)(万|k|m)?$/);
  if (!match) throw new lib.UserError(`${label}は数字で指定してください（例: 1200, 1.2万, 3k）。`);
  const factor = { "万": 10_000, k: 1_000, m: 1_000_000 }[match[2]] ?? 1;
  return Math.round(Number(match[1]) * factor);
}

function cell(value) {
  return String(value ?? "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\|/g, "｜").trim();
}

function readLog(home) {
  const content = lib.readText(logFile(home));
  if (!content) return [];
  const rows = [];
  for (const line of content.split(/\r?\n/)) {
    if (!/^\|\s*\d{8}-\d+\s*\|/.test(line)) continue;
    const cells = line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((part) => part.trim());
    const [id, date, app, channel, format, hook, ...rest] = cells;
    const metrics = Object.fromEntries(METRICS.map(([key], index) => [key, rest[index] === "" || rest[index] === undefined ? null : Number(rest[index])]));
    rows.push({ id, date, app, channel, format, hook, ...metrics, ct: rest[METRICS.length] ?? "", note: rest[METRICS.length + 1] ?? "" });
  }
  return rows;
}

function writeLog(home, rows) {
  const header = `| ${COLUMNS.join(" | ")} |\n|${COLUMNS.map(() => "---").join("|")}|`;
  const body = rows.map((row) => `| ${[row.id, row.date, row.app, row.channel, row.format, row.hook, ...METRICS.map(([key]) => row[key] ?? ""), row.ct, row.note].map(cell).join(" | ")} |`).join("\n");
  lib.writeFileAtomic(logFile(home), `# SNS投稿ログ\n\n<!-- growth.mjs が管理する表です。追加・更新は post add / post update で行ってください。 -->\n\n${header}\n${body}${body ? "\n" : ""}`);
}

function readMetrics(options) {
  return Object.fromEntries(METRICS.map(([key, label]) => [key, parseCount(options[key], label)]).filter(([, value]) => value !== null));
}

function normalizeChannel(value) {
  const key = String(value ?? "").trim().toLowerCase();
  const channel = CHANNELS[key];
  if (!channel) throw new lib.UserError(`チャネルは ${[...new Set(Object.values(CHANNELS))].join(" / ")} のどれかで指定してください。`);
  return channel;
}

export function addPost(home, options) {
  const app = getApp(home, options.app);
  const channel = normalizeChannel(options.channel);
  const format = lib.oneLine(options.format, "形式（--format。例: 画面録画, スライド, 顔出し）", 40);
  const hook = lib.oneLine(options.hook, "フック（--hook。最初の1〜2秒の言葉）", 120);
  const date = options.date ? lib.resolveDateInput(options.date) : lib.formatDate();
  const metrics = readMetrics(options);
  const note = options.note ? lib.oneLine(options.note, "メモ", 200) : "";
  return lib.withLock(home, () => {
    const rows = readLog(home);
    const compact = date.replace(/-/g, "");
    const sameDay = rows.filter((row) => row.id.startsWith(`${compact}-`)).map((row) => Number(row.id.split("-")[1]));
    const id = `${compact}-${Math.max(0, ...sameDay) + 1}`;
    const ct = options.ct ? campaignName(options.ct) : `${channel}-${id}`;
    const row = { id, date, app: app.slug, channel, format, hook, ...Object.fromEntries(METRICS.map(([key]) => [key, metrics[key] ?? null])), ct, note };
    rows.push(row);
    rows.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    writeLog(home, rows);
    return { added: true, post: row, ...trackingLink(app, ct), file: logFile(home) };
  });
}

export function updatePost(home, options) {
  requireMarketing(home);
  const id = String(options.id ?? "").trim();
  if (!/^\d{8}-\d+$/.test(id)) throw new lib.UserError("投稿IDを指定してください（例: 20260924-1）。post list で確認できます。");
  const metrics = readMetrics(options);
  const note = options.note !== undefined ? lib.oneLine(options.note, "メモ", 200) : undefined;
  if (!Object.keys(metrics).length && note === undefined) throw new lib.UserError("更新する数字（--views など）か --note を指定してください。");
  return lib.withLock(home, () => {
    const rows = readLog(home);
    const row = rows.find((entry) => entry.id === id);
    if (!row) throw new lib.UserError(`投稿 ${id} はログにありません。`);
    Object.assign(row, metrics);
    if (note !== undefined) row.note = note;
    writeLog(home, rows);
    return { updated: true, post: row };
  });
}

function recentRows(home, { app, days }) {
  requireMarketing(home);
  const span = days === undefined ? 30 : Number(days);
  if (!Number.isInteger(span) || span < 1 || span > 3650) throw new lib.UserError("--days は1〜3650の整数で指定してください。");
  const since = lib.addDays(lib.formatDate(), -(span - 1));
  if (app) getApp(home, app);
  return { since, rows: readLog(home).filter((row) => row.date >= since && (!app || row.app === app)) };
}

export function listPosts(home, options = {}) {
  const { since, rows } = recentRows(home, options);
  return { since, count: rows.length, posts: rows };
}

function aggregate(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row[key]) ?? [];
    group.push(row);
    groups.set(row[key], group);
  }
  return [...groups.entries()].map(([name, group]) => {
    const measured = group.filter((row) => row.views !== null);
    const sum = (field) => group.reduce((total, row) => total + (row[field] ?? 0), 0);
    const views = sum("views");
    const pageViews = sum("pageViews");
    return {
      [key]: name,
      posts: group.length,
      measured: measured.length,
      avgViews: measured.length ? Math.round(views / measured.length) : null,
      totalPageViews: pageViews,
      pageViewsPer1kViews: views ? Math.round((pageViews / views) * 1000 * 10) / 10 : null,
      installs: sum("installs"),
    };
  }).sort((a, b) => (b.totalPageViews - a.totalPageViews) || ((b.avgViews ?? 0) - (a.avgViews ?? 0)));
}

export function summarizePosts(home, options = {}) {
  const { since, rows } = recentRows(home, options);
  const pick = (row) => ({ id: row.id, date: row.date, channel: row.channel, format: row.format, hook: row.hook, views: row.views, pageViews: row.pageViews, installs: row.installs });
  const top = (field) => rows.filter((row) => row[field] !== null).sort((a, b) => b[field] - a[field]).slice(0, 5).map(pick);
  return {
    since,
    posts: rows.length,
    unmeasured: rows.filter((row) => row.views === null).map((row) => row.id),
    totals: Object.fromEntries(METRICS.map(([key]) => [key, rows.reduce((total, row) => total + (row[key] ?? 0), 0)])),
    byChannel: aggregate(rows, "channel"),
    byFormat: aggregate(rows, "format"),
    topByPageViews: top("pageViews"),
    topByViews: top("views"),
  };
}

// ---------- weeks ----------

// ISO week (Monday start) containing `date`, plus the previous week, for weekly reports.
export function isoWeek(date = lib.formatDate()) {
  const { period, start, end } = lib.weekOf(date);
  return { week: period, start, end, previousStart: lib.addDays(start, -7), previousEnd: lib.addDays(start, -1) };
}

// ---------- CLI ----------

const USAGE = `マーケティング部 CLI

  app list
  app init <アプリID> --name <名前> [--stage prelaunch|live] [--app-store-id <数字>] [--country jp] [--provider-token <pt>]
  app set <アプリID> [--name ..] [--stage prelaunch|live] [--app-store-id ..] [--country ..] [--provider-token ..]
  post add --channel <tiktok|instagram|youtube|x|threads|note|other> --format <形式> --hook <フック>
           [--app <アプリID>] [--date <日付>] [--ct <キャンペーン名>] [--views ..] [--likes ..] [--saves ..]
           [--page-views ..] [--installs ..] [--note ..]
  post update <投稿ID> [--views ..] [--likes ..] [--saves ..] [--page-views ..] [--installs ..] [--note ..]
  post list [--app ..] [--days 30]
  post summary [--app ..] [--days 30]
  link --ct <キャンペーン名> [--app <アプリID>]
  week [--date <日付>]

共通: [--home <AI秘書のデータフォルダ>]  数字は 1200 / 1.2万 / 3k の形で入力できます。`;

const METRIC_OPTIONS = ["views", "likes", "saves", "pageViews", "installs", "note"];
const COMMANDS = {
  "app list": { run: (home) => ({ apps: listApps(home) }) },
  "app init": { options: ["name", "stage", "appStoreId", "country", "providerToken"], positional: true, run: (home, o, p) => initApp(home, { ...o, slug: p[0] }) },
  "app set": { options: ["name", "stage", "appStoreId", "country", "providerToken"], positional: true, run: (home, o, p) => setApp(home, { ...o, slug: p[0] }) },
  "post add": { options: ["app", "channel", "format", "hook", "date", "ct", ...METRIC_OPTIONS], run: (home, o) => addPost(home, o) },
  "post update": { options: METRIC_OPTIONS, positional: true, run: (home, o, p) => updatePost(home, { ...o, id: p[0] }) },
  "post list": { options: ["app", "days"], run: (home, o) => listPosts(home, o) },
  "post summary": { options: ["app", "days"], run: (home, o) => summarizePosts(home, o) },
  link: { options: ["app", "ct"], run: (home, o) => ({ ct: campaignName(o.ct), ...trackingLink(getApp(home, o.app), campaignName(o.ct)) }) },
  week: { options: ["date"], run: (_home, o) => isoWeek(o.date ? lib.resolveDateInput(o.date) : undefined) },
};

const camel = (key) => key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function main(argv) {
  const { positional, options: raw } = parseArgs(argv);
  if (raw.help || positional.length === 0) return USAGE;
  const options = Object.fromEntries(Object.entries(raw).map(([key, value]) => [camel(key), value]));
  const twoWord = `${positional[0]} ${positional[1] ?? ""}`;
  const name = COMMANDS[twoWord] ? twoWord : positional[0];
  const command = COMMANDS[name];
  if (!command) throw new lib.UserError(`「${positional.join(" ")}」というコマンドはありません。\n\n${USAGE}`);
  const rest = positional.slice(name.split(" ").length);
  const allowed = new Set([...(command.options ?? []), "home"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new lib.UserError(`「${name}」では --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} は使えません。\n\n${USAGE}`);
  }
  if (rest.length && !command.positional) throw new lib.UserError(`「${name}」に余分な引数があります: ${rest.join(" ")}`);
  const home = lib.resolveHome(options.home);
  delete options.home;
  return command.run(home, options, rest);
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  try {
    const result = main(process.argv.slice(2));
    process.stdout.write(typeof result === "string" ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(error instanceof lib.UserError ? `${error.message}\n` : `予期しないエラー: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}

export { main };
