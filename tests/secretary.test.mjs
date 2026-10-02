import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as lib from "../secretary/scripts/lib.mjs";
import { createDashboard } from "../secretary/scripts/dashboard.mjs";

const CLI = fileURLToPath(new URL("../secretary/scripts/secretary.mjs", import.meta.url));
const temps = [];
after(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-secretary-test-"));
  temps.push(dir);
  return path.join(dir, "home");
}

function initialized() {
  const home = tempHome();
  lib.init(home, { business: "フリーランスのWeb開発", goals: "SaaSで月10万" });
  return home;
}

function cli(home, ...args) {
  const result = spawnSync(process.execPath, [CLI, ...args, `--home=${home}`], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr, json: result.status === 0 && result.stdout.startsWith("{") ? JSON.parse(result.stdout) : null };
}

const today = lib.formatDate();
const yesterday = lib.addDays(today, -1);

describe("setup", () => {
  test("init creates the folder layout and today's TODO", () => {
    const home = initialized();
    for (const dir of ["todos", "inbox", "notes", "decisions", "briefs", "departments"]) assert.ok(fs.existsSync(path.join(home, dir)), dir);
    assert.ok(fs.existsSync(path.join(home, "todos", `${today}.md`)));
    assert.equal(lib.init(home, { business: "x", goals: "y" }).alreadyInitialized, true);
  });

  test("commands on an uninitialised home fail without creating anything", () => {
    const home = tempHome();
    const result = cli(home, "todo", "add", "テスト");
    assert.equal(result.code, 1);
    assert.match(result.err, /初期化されていません/);
    assert.equal(fs.existsSync(home), false);
  });

  test("status reports not-initialised without side effects", () => {
    const home = tempHome();
    assert.equal(lib.status(home).initialized, false);
    assert.equal(fs.existsSync(home), false);
  });
});

describe("todos", () => {
  test("add, list, done and undo", () => {
    const home = initialized();
    lib.addTodo(home, { text: "見積もり送付", priority: "高", due: "+2" });
    lib.addTodo(home, { text: "LPレビュー" });
    lib.addTodo(home, { text: "本を読む", priority: "low" });
    const listed = lib.listTodos(home);
    assert.deepEqual(listed.items.map((item) => [item.n, item.priority, item.text]), [[1, "high", "見積もり送付"], [2, "normal", "LPレビュー"], [3, "low", "本を読む"]]);
    assert.equal(listed.items[0].due, lib.addDays(today, 2));

    lib.setTodoDone(home, { target: "2" });
    lib.setTodoDone(home, { target: "見積" });
    assert.equal(lib.listTodos(home).done, 2);
    lib.setTodoDone(home, { target: "LP", done: false });
    assert.equal(lib.listTodos(home).open, 2);
  });

  test("duplicate open TODOs are not added twice", () => {
    const home = initialized();
    assert.equal(lib.addTodo(home, { text: "同じ" }).added, true);
    assert.equal(lib.addTodo(home, { text: "同じ" }).added, false);
  });

  test("ambiguous text match asks for a number", () => {
    const home = initialized();
    lib.addTodo(home, { text: "資料A作成" });
    lib.addTodo(home, { text: "資料B作成" });
    assert.throws(() => lib.setTodoDone(home, { target: "資料" }), /複数/);
  });

  test("unfinished items carry over from the previous day exactly once", () => {
    const home = tempHome();
    fs.mkdirSync(path.join(home, "todos"), { recursive: true });
    fs.writeFileSync(path.join(home, "todos", `${yesterday}.md`), `# TODO ${yesterday}\n\n## 最優先\n- [ ] 請求書（期限: ${today}）\n\n## 通常\n- [x] 済んだこと\n- [ ] 続きの作業\n\n## 余裕があれば\n\n## メモ・振り返り\n`);
    const result = lib.init(home, { business: "a", goals: "b" });
    assert.equal(result.carried, 2);

    const items = lib.listTodos(home).items;
    assert.deepEqual(items.map((item) => [item.priority, item.text, item.due]), [["high", "請求書", today], ["normal", "続きの作業", null]]);
    const old = fs.readFileSync(path.join(home, "todos", `${yesterday}.md`), "utf8");
    assert.match(old, /- \[>\] 請求書/);
    assert.match(old, /- \[x\] 済んだこと/);

    const brief = lib.buildBrief(home, { save: true });
    assert.equal(brief.carriedNow, 0);
    assert.equal(brief.previous.carried, 2);
    assert.equal(brief.dueSoon.length, 1);
    assert.match(brief.markdown, /今日まで/);
    assert.ok(fs.existsSync(path.join(home, "briefs", `${today}.md`)));
  });

  test("invalid dates and priorities are rejected", () => {
    const home = initialized();
    assert.throws(() => lib.addTodo(home, { text: "x", due: "2026-02-30" }), /存在しない日付/);
    assert.throws(() => lib.addTodo(home, { text: "x", priority: "urgent" }), /優先度/);
  });
});

describe("memos, decisions, departments", () => {
  test("memos and decisions are appended, never replaced", () => {
    const home = initialized();
    lib.addMemo(home, { text: "1つ目" });
    lib.addMemo(home, { text: "2つ目\n改行あり" });
    const memo = fs.readFileSync(path.join(home, "inbox", `${today}.md`), "utf8");
    assert.match(memo, /1つ目/);
    assert.match(memo, /2つ目 改行あり/);

    lib.addDecision(home, { title: "価格", decision: "月額980円", reason: "競合より安く" });
    lib.addDecision(home, { title: "名前", decision: "AI秘書" });
    const decisions = fs.readFileSync(path.join(home, "decisions", `${today.slice(0, 7)}.md`), "utf8");
    assert.match(decisions, /月額980円[\s\S]*AI秘書/);
  });

  test("departments: known, custom, idempotent, and memo tagging", () => {
    const home = initialized();
    assert.equal(lib.addDepartment(home, { id: "research" }).created, true);
    assert.ok(fs.existsSync(path.join(home, "departments", "research", "topics")));
    fs.appendFileSync(path.join(home, "departments", "research", "RULES.md"), "- 自分で足したルール\n");
    assert.equal(lib.addDepartment(home, { id: "research" }).created, false);
    assert.match(fs.readFileSync(path.join(home, "departments", "research", "RULES.md"), "utf8"), /自分で足したルール/);

    lib.addDepartment(home, { id: "side-project", name: "副業", role: "副業アプリ" });
    assert.deepEqual(lib.listDepartments(home).departments.map((d) => d.name), ["リサーチ", "副業"]);
    assert.throws(() => lib.addDepartment(home, { id: "Bad ID" }), /英小文字/);

    lib.addMemo(home, { text: "競合を調べる", dept: "research" });
    assert.match(fs.readFileSync(path.join(home, "inbox", `${today}.md`), "utf8"), /\[リサーチ\] 競合を調べる/);
    assert.throws(() => lib.addMemo(home, { text: "x", dept: "nope" }), /まだありません/);
  });

  test("PM milestones due within 7 days appear in status and the morning brief", () => {
    const home = initialized();
    lib.addDepartment(home, { id: "pm" });
    assert.match(fs.readFileSync(path.join(home, "departments", "pm", "RULES.md"), "utf8"), /（期限: YYYY-MM-DD）/);
    const file = path.join(home, "departments", "pm", "projects", "app.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      "# テストアプリ", "", "## マイルストーン", "",
      `- [x] 終わったこと（期限: ${today}）`,
      `- [ ] 審査に提出（期限: ${lib.addDays(today, 2)}）`,
      `- [ ] 遅れていること（期限: ${lib.addDays(today, -1)}）`,
      `- [ ] 来月のこと（期限: ${lib.addDays(today, 30)}）`,
      "- [ ] 期限なし",
    ].join("\n"));

    const milestones = lib.upcomingMilestones(home);
    assert.deepEqual(milestones.map((m) => [m.text, m.overdue]), [["遅れていること", true], ["審査に提出", false]]);
    assert.equal(milestones[0].project, "テストアプリ");
    assert.equal(lib.status(home).milestones.length, 2);

    const brief = lib.buildBrief(home);
    assert.match(brief.markdown, /## プロジェクトの予定（7日以内）/);
    assert.match(brief.markdown, /期限切れ.*テストアプリ — 遅れていること/);
    assert.match(brief.markdown, /あと2日.*審査に提出/);
    assert.doesNotMatch(brief.markdown, /来月のこと/);
    assert.equal(lib.dashboardState(home).milestones.length, 2);
  });

  test("doctor reports a healthy store", () => {
    const home = initialized();
    assert.equal(lib.doctor(home).ok, true);
    assert.equal(lib.doctor(tempHome()).ok, false);
  });
});

describe("CLI", () => {
  test("happy path with positional text and --key=value", () => {
    const home = initialized();
    assert.equal(cli(home, "todo", "add", "見積もり", "送付", "--priority", "high").json.text, "見積もり 送付");
    assert.equal(cli(home, "memo", "add", "--text=--から始まるメモ").code, 0);
    assert.equal(cli(home, "todo", "list").json.open, 1);
    assert.equal(cli(home, "todo", "done", "1").json.changed, true);
  });

  test("typos in options are errors, not silently ignored", () => {
    const home = initialized();
    const result = cli(home, "todo", "add", "x", "--priorty", "high");
    assert.equal(result.code, 1);
    assert.match(result.err, /--priorty は使えません/);
  });

  test("a missing option value is explained", () => {
    const home = initialized();
    const result = cli(home, "memo", "add", "--text", "--oops");
    assert.equal(result.code, 1);
    assert.match(result.err, /--text=値/);
  });

  test("unknown command shows usage", () => {
    const result = cli(tempHome(), "fly");
    assert.equal(result.code, 1);
    assert.match(result.err, /使い方/);
  });
});

describe("dashboard", () => {
  async function start(home) {
    const server = createDashboard(home);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const stop = () => new Promise((resolve) => { server.closeClients(); server.close(resolve); });
    return { port, stop };
  }

  function request(port, { method = "GET", pathname = "/", host = `127.0.0.1:${port}`, headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers: { Host: host, ...headers } }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  test("serves the page and state to localhost only", async () => {
    const home = initialized();
    lib.addTodo(home, { text: "ダッシュボード確認" });
    const { port, stop } = await start(home);
    try {
      const page = await request(port);
      assert.equal(page.status, 200);
      assert.match(page.headers["content-security-policy"], /script-src 'self'/);
      const stateResponse = await request(port, { pathname: "/api/state" });
      assert.equal(JSON.parse(stateResponse.body).todo.items[0].text, "ダッシュボード確認");
      assert.equal((await request(port, { pathname: "/api/state", host: `localhost:${port}` })).status, 200);
      assert.equal((await request(port, { pathname: "/api/state", host: "evil.example" })).status, 403, "DNS rebinding host must be rejected");
    } finally {
      await stop();
    }
  });

  test("department API lists a department's files with the rules first", async () => {
    const home = initialized();
    lib.addDepartment(home, { id: "quality" });
    fs.writeFileSync(path.join(home, "departments", "quality", "bugs", "bug-1.md"), "# 錠が開かない\n");
    const { port, stop } = await start(home);
    try {
      const ok = await request(port, { pathname: "/api/department?id=quality" });
      assert.equal(ok.status, 200);
      const body = JSON.parse(ok.body);
      assert.equal(body.department.name, "品質管理");
      assert.deepEqual(body.files.map((file) => [file.path, file.rules]), [["departments/quality/RULES.md", true], ["departments/quality/bugs/bug-1.md", false]]);
      assert.equal(body.files[1].title, "錠が開かない");
      assert.equal((await request(port, { pathname: "/api/department?id=nope" })).status, 404);
      assert.equal((await request(port, { pathname: "/api/department?id=../../x" })).status, 404);
    } finally {
      await stop();
    }
  });

  test("file API refuses paths outside the data folder and non-Markdown files", async () => {
    const home = initialized();
    const { port, stop } = await start(home);
    try {
      for (const bad of ["../secret.md", "config.json", ".lock", "..%2F..%2Fx.md", "C:/Windows/win.ini"]) {
        assert.equal((await request(port, { pathname: `/api/file?path=${encodeURIComponent(bad)}` })).status, 404, bad);
      }
      const ok = await request(port, { pathname: `/api/file?path=${encodeURIComponent(`todos/${today}.md`)}` });
      assert.equal(ok.status, 200);
    } finally {
      await stop();
    }
  });

  test("toggling a TODO requires the custom header and matching text", async () => {
    const home = initialized();
    lib.addTodo(home, { text: "チェックする" });
    const { port, stop } = await start(home);
    try {
      const item = lib.listTodos(home).items[0];
      const body = JSON.stringify({ date: today, line: item.line, text: item.text, done: true });
      const json = { "Content-Type": "application/json" };
      assert.equal((await request(port, { method: "POST", pathname: "/api/todo", headers: json, body })).status, 403);
      assert.equal((await request(port, { method: "POST", pathname: "/api/todo", headers: { ...json, "X-Secretary": "1", Origin: "http://evil.example" }, body })).status, 403);
      const stale = JSON.stringify({ date: today, line: item.line, text: "別の内容", done: true });
      assert.equal((await request(port, { method: "POST", pathname: "/api/todo", headers: { ...json, "X-Secretary": "1" }, body: stale })).status, 400);
      assert.equal((await request(port, { method: "POST", pathname: "/api/todo", headers: { ...json, "X-Secretary": "1" }, body })).status, 200);
      assert.equal(lib.listTodos(home).done, 1);
    } finally {
      await stop();
    }
  });

  test("live updates fire when a file changes", async () => {
    const home = initialized();
    const { port, stop } = await start(home);
    try {
      const gotUpdate = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no update event within 5s")), 5000);
        const req = http.get({ host: "127.0.0.1", port, path: "/api/events", headers: { Host: `127.0.0.1:${port}` } }, (res) => {
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            if (chunk.includes("retry:")) setTimeout(() => lib.addMemo(home, { text: "更新テスト" }), 300);
            if (chunk.includes("event: update")) {
              clearTimeout(timer);
              req.destroy();
              resolve();
            }
          });
        });
        req.on("error", () => {});
      });
      await gotUpdate;
    } finally {
      await stop();
    }
  });
});
