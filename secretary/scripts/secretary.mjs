#!/usr/bin/env node
// Command-line entry point. Prints JSON so Claude (or a person) can read the result.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as lib from "./lib.mjs";

const textFrom = (options, positional) => options.text ?? (positional.length ? positional.join(" ") : undefined);

const COMMANDS = {
  status: { run: (home) => lib.status(home) },
  init: { options: ["business", "goals"], run: (home, o) => lib.init(home, o) },
  "profile set": { options: ["business", "goals"], run: (home, o) => lib.setProfile(home, o) },
  "todo add": {
    options: ["text", "priority", "due", "date", "replace"],
    positional: "text",
    run: (home, o, p) => lib.addTodo(home, { ...o, text: textFrom(o, p) }),
  },
  "todo list": { options: ["date"], run: (home, o) => lib.listTodos(home, o) },
  "todo done": { options: ["date"], positional: "target", run: (home, o, p) => lib.setTodoDone(home, { ...o, target: p.join(" "), done: true }) },
  "todo undo": { options: ["date"], positional: "target", run: (home, o, p) => lib.setTodoDone(home, { ...o, target: p.join(" "), done: false }) },
  "todo drop": { options: ["date", "reason"], positional: "target", run: (home, o, p) => lib.dropTodo(home, { ...o, target: p.join(" ") }) },
  "memo add": { options: ["text", "dept"], positional: "text", run: (home, o, p) => lib.addMemo(home, { ...o, text: textFrom(o, p) }) },
  "decision add": { options: ["title", "decision", "reason"], run: (home, o) => lib.addDecision(home, o) },
  "dept add": { options: ["name", "role"], positional: "id", run: (home, o, p) => lib.addDepartment(home, { ...o, id: p[0] }) },
  "dept list": { run: (home) => lib.listDepartments(home) },
  "pm list": { positional: "project", run: (home, o, p) => lib.listProjects(home, { project: p[0] }) },
  "pm add": {
    options: ["due", "section", "text"],
    positional: "project",
    run: (home, o, p) => lib.addMilestone(home, { ...o, project: p[0], text: o.text ?? (p.length > 1 ? p.slice(1).join(" ") : undefined) }),
  },
  "pm done": { positional: "project", run: (home, o, p) => lib.setMilestoneDone(home, { project: p[0], target: p.slice(1).join(" "), done: true }) },
  "pm undo": { positional: "project", run: (home, o, p) => lib.setMilestoneDone(home, { project: p[0], target: p.slice(1).join(" "), done: false }) },
  "pm due": { options: ["due"], positional: "project", run: (home, o, p) => lib.setMilestoneDue(home, { ...o, project: p[0], target: p.slice(1).join(" ") }) },
  "pm log": { options: ["text"], positional: "project", run: (home, o, p) => lib.addProgressLog(home, { project: p[0], text: o.text ?? (p.length > 1 ? p.slice(1).join(" ") : undefined) }) },
  "pm link": { options: ["repo"], positional: "project", run: (home, o, p) => lib.linkRepo(home, { ...o, project: p[0] }) },
  dev: { options: ["hours"], run: (home, o) => lib.devActivity(home, o) },
  brief: { options: ["date"], flags: ["save"], run: (home, o) => lib.buildBrief(home, o) },
  doctor: { run: (home) => lib.doctor(home) },
};

const USAGE = `AI秘書 ${lib.VERSION}

使い方: node secretary.mjs <コマンド> [オプション] [--home <データフォルダ>]

  status                                   初期化状態と今日の概要
  init --business <事業> --goals <目標>     初回セットアップ
  profile set [--business ..] [--goals ..]  プロフィール更新
  todo add <内容> [--priority high|normal|low] [--due <日付>] [--date <日付>] [--replace <先頭の文字>]
                                           --replace: 先頭が同じ未完了のTODOを置き換える（毎日のTODOをためない）
  todo list [--date <日付>]
  todo done <番号か文字>  /  todo undo <番号か文字>
  todo drop <番号か文字> [--reason <理由>]   完了にせず見送る（メモ欄に記録）
  memo add <内容> [--dept <部署ID>]
  decision add --title <件名> --decision <判断> [--reason <理由>]
  dept add <部署ID> [--name <名前>] [--role <役割>]
  dept list
  pm list [<プロジェクトID>]                プロジェクトとマイルストーンの一覧
  pm add <プロジェクトID> <内容> --due <日付> [--section <小見出し>]
  pm done <プロジェクトID> <番号か文字>  /  pm undo <プロジェクトID> <番号か文字>
  pm due <プロジェクトID> <番号か文字> --due <日付>   期限を変える
  pm log <プロジェクトID> <内容>            進捗ログに追記
  pm link <プロジェクトID> --repo <フォルダ>  開発のリポジトリをつなぐ（朝のまとめに開発の動きが載る）
  dev [--hours 36]                         つないだリポジトリの最近のコミット
  brief [--date <日付>] [--save]             朝のまとめ
  doctor                                   データの点検

日付は YYYY-MM-DD / today / tomorrow / 今日 / 明日 / +3（3日後）が使えます。
「--」で始まる値は --text=--値 のように = でつなげてください。
データフォルダ: --home > 環境変数 AI_SECRETARY_HOME > ~/ai-secretary`;

const BOOLEAN_FLAGS = new Set(["save", "help", "version"]);

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    if (!key) throw new lib.UserError(`オプション「${arg}」が読み取れません。`);
    if (key in options) throw new lib.UserError(`--${key} が2回指定されています。`);
    if (BOOLEAN_FLAGS.has(key)) {
      if (eq > 0) throw new lib.UserError(`--${key} は値をとりません。`);
      options[key] = true;
      continue;
    }
    let value;
    if (eq > 0) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new lib.UserError(`--${key} の値がありません。「--」で始まる値は --${key}=値 の形で指定してください。`);
      }
      index += 1;
    }
    options[key] = value;
  }
  return { positional, options };
}

function main(argv) {
  const { positional, options } = parseArgs(argv);
  if (options.version) return lib.VERSION;
  if (options.help || positional.length === 0) return USAGE;

  const twoWord = `${positional[0]} ${positional[1] ?? ""}`;
  const name = COMMANDS[twoWord] ? twoWord : positional[0];
  const command = COMMANDS[name];
  if (!command) throw new lib.UserError(`「${positional.join(" ")}」というコマンドはありません。\n\n${USAGE}`);
  const rest = positional.slice(name.split(" ").length);

  const allowed = new Set([...(command.options ?? []), ...(command.flags ?? []), "home"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      const list = [...allowed].map((option) => `--${option}`).join(", ");
      throw new lib.UserError(`「${name}」では --${key} は使えません。使えるオプション: ${list}`);
    }
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

export { main, parseArgs };
