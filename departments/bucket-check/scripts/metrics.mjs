#!/usr/bin/env node
// Analytics department CLI: record weekly bucket metrics and summarise where users leak.
// Data lives in <AI秘書 home>/departments/analytics/apps/<app>/metrics.json.

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

const USAGE = `分析部 CLI（バケツの数字）

  apps                                         指標が定義されているアプリの一覧
  show <アプリID> [--period 2026-W40]           その週と前週の比較・ファネルの通過率・一番の穴
  record <アプリID> --values "installs=120,signups=80,d7_retention=31.5" [--period 2026-W40] [--note ..]
                                               週の数字を記録（同じ週はマージ）。期間の省略時は今週
  week [--date YYYY-MM-DD]                     その日を含む ISO 週（先週なら7日前の日付を渡す）
  validate <アプリID>                           metrics.json の定義を確認

共通: [--home <AI秘書のデータフォルダ>]`;

function parseValues(text) {
  if (typeof text !== "string" || !text.trim()) throw new lib.UserError("--values に「指標ID=数字」をカンマ区切りで指定してください。");
  const values = {};
  for (const pair of text.split(",")) {
    const match = pair.trim().match(/^([a-z][a-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) throw new lib.UserError(`「${pair.trim()}」は「指標ID=数字」の形になっていません。`);
    values[match[1]] = Number(match[2]);
  }
  return values;
}

const COMMANDS = {
  apps: { run: (home) => ({ apps: lib.listMetricApps(home) }) },
  show: { options: ["period"], positional: true, run: (home, o, p) => lib.summarizeMetrics(home, p[0], o) },
  record: {
    options: ["period", "values", "note"],
    positional: true,
    run: (home, o, p) => lib.recordSnapshot(home, p[0], { period: o.period, values: parseValues(o.values), note: o.note }),
  },
  week: { options: ["date"], run: (_home, o) => lib.weekOf(o.date ? lib.resolveDateInput(o.date) : undefined) },
  validate: { positional: true, run: (home, _o, p) => ({ ok: true, metrics: lib.readMetrics(home, p[0]).metrics.length }) },
};

function main(argv) {
  const { positional, options } = parseArgs(argv);
  if (options.help || positional.length === 0) return USAGE;
  const command = COMMANDS[positional[0]];
  if (!command) throw new lib.UserError(`「${positional[0]}」というコマンドはありません。\n\n${USAGE}`);
  for (const key of Object.keys(options)) {
    if (![...(command.options ?? []), "home"].includes(key)) throw new lib.UserError(`「${positional[0]}」では --${key} は使えません。\n\n${USAGE}`);
  }
  const rest = positional.slice(1);
  if (command.positional && !rest[0]) throw new lib.UserError(`アプリIDを指定してください。\n\n${USAGE}`);
  if (!command.positional && rest.length) throw new lib.UserError(`「${positional[0]}」に余分な引数があります: ${rest.join(" ")}`);
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

export { main, parseValues };
