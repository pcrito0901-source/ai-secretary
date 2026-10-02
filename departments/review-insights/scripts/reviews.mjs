#!/usr/bin/env node
// Public App Store data for review research: iTunes Search / Lookup APIs and the customer-review RSS feed.
// No API key needed. Reviewer names are dropped on purpose.

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

const TIMEOUT_MS = 15_000;
const MAX_PAGES = 10;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new lib.UserError(`App Store からエラーが返りました（${response.status}）。時間をおいて再実行してください。`);
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof lib.UserError) throw error;
    throw new lib.UserError(`App Store に接続できませんでした: ${error.name === "AbortError" ? "タイムアウト" : error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function country(value) {
  const code = String(value ?? "jp").toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) throw new lib.UserError("--country は jp, us のような英小文字2文字で指定してください。");
  return code;
}

function appId(value) {
  const id = String(value ?? "").trim().replace(/^id/, "");
  if (!/^\d{6,12}$/.test(id)) throw new lib.UserError("App Store ID（数字）を指定してください。App Store の URL の id の後ろの数字です。");
  return id;
}

function toApp(result, { withDescription = false } = {}) {
  return {
    id: String(result.trackId),
    name: result.trackName,
    seller: result.sellerName,
    genre: result.primaryGenreName,
    rating: result.averageUserRating !== undefined ? Math.round(result.averageUserRating * 100) / 100 : null,
    ratings: result.userRatingCount ?? 0,
    price: result.formattedPrice ?? null,
    version: result.version,
    released: result.releaseDate?.slice(0, 10) ?? null,
    updated: result.currentVersionReleaseDate?.slice(0, 10) ?? null,
    url: result.trackViewUrl,
    ...(withDescription ? { description: String(result.description ?? "").slice(0, 2000) } : {}),
  };
}

export async function searchApps({ term, country: code, limit }) {
  const query = lib.oneLine(term, "検索キーワード", 100);
  const size = limit === undefined ? 10 : Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > 50) throw new lib.UserError("--limit は1〜50で指定してください。");
  const params = new URLSearchParams({ term: query, country: country(code), entity: "software", limit: String(size) });
  const data = await getJson(`https://itunes.apple.com/search?${params}`);
  return { term: query, country: country(code), apps: (data?.results ?? []).filter((result) => result.kind === "software").map((result) => toApp(result)) };
}

export async function lookupApps({ ids, country: code }) {
  if (!ids.length) throw new lib.UserError("App Store ID を1つ以上指定してください。");
  const list = ids.map(appId);
  const params = new URLSearchParams({ id: list.join(","), country: country(code) });
  const data = await getJson(`https://itunes.apple.com/lookup?${params}`);
  const apps = (data?.results ?? []).filter((result) => result.kind === "software").map((result) => toApp(result, { withDescription: true }));
  const missing = list.filter((id) => !apps.some((app) => app.id === id));
  return { country: country(code), apps, missing };
}

// The feed returns `entry` as an array, a single object, or not at all.
// Older feeds put the app itself first as an entry without a rating; those are skipped.
export function parseReviewFeed(json) {
  const entries = json?.feed?.entry;
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  return list
    .filter((entry) => entry?.["im:rating"]?.label)
    .map((entry) => ({
      id: entry.id?.label ?? null,
      rating: Number(entry["im:rating"].label),
      title: String(entry.title?.label ?? "").trim(),
      body: String((Array.isArray(entry.content) ? entry.content[0] : entry.content)?.label ?? "").trim(),
      version: entry["im:version"]?.label ?? null,
      date: String(entry.updated?.label ?? "").slice(0, 10) || null,
    }));
}

export function summarizeReviews(reviews) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const versions = new Map();
  for (const review of reviews) {
    if (distribution[review.rating] !== undefined) distribution[review.rating] += 1;
    const entry = versions.get(review.version) ?? { version: review.version, count: 0, total: 0 };
    entry.count += 1;
    entry.total += review.rating;
    versions.set(review.version, entry);
  }
  const average = reviews.length ? Math.round((reviews.reduce((total, review) => total + review.rating, 0) / reviews.length) * 100) / 100 : null;
  const dates = reviews.map((review) => review.date).filter(Boolean).sort();
  return {
    count: reviews.length,
    average,
    distribution,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    byVersion: [...versions.values()].map(({ version, count, total }) => ({ version, count, average: Math.round((total / count) * 100) / 100 })).sort((a, b) => b.count - a.count).slice(0, 8),
  };
}

export async function fetchReviews({ id, country: code, pages, minRating, maxRating, save, home }) {
  const app = appId(id);
  const region = country(code);
  const pageCount = pages === undefined ? 2 : Number(pages);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) throw new lib.UserError(`--pages は1〜${MAX_PAGES}で指定してください（1ページ最大50件）。`);
  const min = minRating === undefined ? 1 : Number(minRating);
  const max = maxRating === undefined ? 5 : Number(maxRating);
  if (![min, max].every((value) => Number.isInteger(value) && value >= 1 && value <= 5) || min > max) throw new lib.UserError("--min-rating / --max-rating は1〜5で指定してください。");

  const reviews = [];
  const seen = new Set();
  for (let page = 1; page <= pageCount; page += 1) {
    const data = await getJson(`https://itunes.apple.com/${region}/rss/customerreviews/page=${page}/id=${app}/sortby=mostrecent/json`);
    const batch = parseReviewFeed(data);
    if (!batch.length) break;
    for (const review of batch) {
      const key = review.id ?? `${review.date}:${review.title}:${review.body.slice(0, 40)}`;
      if (!seen.has(key)) {
        seen.add(key);
        reviews.push(review);
      }
    }
  }
  const info = (await lookupApps({ ids: [app], country: region })).apps[0] ?? { id: app };
  const filtered = reviews.filter((review) => review.rating >= min && review.rating <= max);
  const result = { app: info, country: region, summary: summarizeReviews(reviews), filter: { minRating: min, maxRating: max, matched: filtered.length } };

  if (save) {
    const config = lib.readConfig(home);
    if (!config.departments.some((department) => department.id === "research")) {
      throw new lib.UserError("リサーチ部がまだありません。先に secretary の `dept add research` を実行するか、--save を外してください。");
    }
    const file = path.join(home, "departments", "research", "topics", "reviews", "data", `${lib.formatDate()}-${app}-${region}.json`);
    lib.writeFileAtomic(file, `${JSON.stringify({ ...result, fetchedAt: new Date().toISOString(), reviews: filtered }, null, 2)}\n`);
    return { ...result, file, note: "レビュー本文はファイルに保存しました。Read ツールで読み込んで分析してください。" };
  }
  return { ...result, reviews: filtered.map((review) => ({ ...review, body: review.body.slice(0, 600) })) };
}

const USAGE = `レビュー調査 CLI（App Store の公開データ・APIキー不要）

  search <キーワード> [--country jp] [--limit 10]     アプリを探す
  lookup <App Store ID> [<ID> ...] [--country jp]    アプリの詳細（説明文・評価）
  fetch <App Store ID> [--country jp] [--pages 2] [--min-rating 1] [--max-rating 5] [--save]
                                                     最新レビューを取得（1ページ50件・最大10ページ）

--save を付けると AI秘書のリサーチ部（topics/reviews/data/）に保存し、要約だけを表示します。
共通: [--home <AI秘書のデータフォルダ>]`;

const COMMANDS = {
  search: { options: ["country", "limit"], run: (_home, o, p) => searchApps({ ...o, term: p.join(" ") }) },
  lookup: { options: ["country"], run: (_home, o, p) => lookupApps({ ...o, ids: p }) },
  fetch: { options: ["country", "pages", "minRating", "maxRating", "save"], run: (home, o, p) => fetchReviews({ ...o, id: p[0], home }) },
};

async function main(argv) {
  const { positional, options: raw } = parseArgs(argv);
  if (raw.help || positional.length === 0) return USAGE;
  const options = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
  const command = COMMANDS[positional[0]];
  if (!command) throw new lib.UserError(`「${positional[0]}」というコマンドはありません。\n\n${USAGE}`);
  for (const key of Object.keys(options)) {
    if (![...command.options, "home"].includes(key)) throw new lib.UserError(`「${positional[0]}」では --${key} は使えません。\n\n${USAGE}`);
  }
  const home = lib.resolveHome(options.home);
  delete options.home;
  return command.run(home, options, positional.slice(1));
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
  main(process.argv.slice(2))
    .then((result) => process.stdout.write(typeof result === "string" ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(error instanceof lib.UserError ? `${error.message}\n` : `予期しないエラー: ${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}

export { main };
