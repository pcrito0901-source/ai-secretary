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

describe("todo drop and replace", () => {
  test("drop removes an open item and notes it in the memo section", () => {
    const home = initialized();
    lib.addTodo(home, { text: "古いSNS投稿" });
    lib.addTodo(home, { text: "請求書を送る" });
    const result = lib.dropTodo(home, { target: "SNS", reason: "新しい案に切り替え" });
    assert.equal(result.dropped.text, "古いSNS投稿");
    const content = fs.readFileSync(result.file, "utf8");
    assert.ok(!content.includes("- [ ] 古いSNS投稿"));
    assert.match(content, /見送り: 古いSNS投稿（新しい案に切り替え）/);
    assert.deepEqual(lib.listTodos(home).items.map((item) => item.text), ["請求書を送る"]);
    assert.throws(() => lib.dropTodo(home, { target: "存在しない" }), /ありません/);
  });

  test("replace keeps only the newest daily item with the same prefix", () => {
    const home = initialized();
    lib.addTodo(home, { text: "SNS投稿: アプリ（案: content/a.md）" });
    lib.addTodo(home, { text: "SNS投稿: アプリ（案: content/b.md）" });
    lib.addTodo(home, { text: "ほかのTODO" });
    const result = lib.addTodo(home, { text: "SNS投稿: アプリ（案: content/c.md）", replace: "SNS投稿: アプリ" });
    assert.equal(result.added, true);
    assert.equal(result.replaced.length, 2);
    assert.deepEqual(lib.listTodos(home).items.map((item) => item.text), ["ほかのTODO", "SNS投稿: アプリ（案: content/c.md）"]);
    assert.match(fs.readFileSync(result.file, "utf8"), /置き換え: SNS投稿: アプリ（案: content\/a\.md）/);
  });

  test("CLI todo drop", () => {
    const home = initialized();
    cli(home, "todo", "add", "見送るもの");
    const result = cli(home, "todo", "drop", "1", "--reason", "不要になった");
    assert.equal(result.code, 0, result.err);
    assert.equal(result.json.dropped.text, "見送るもの");
  });
});

describe("pm: milestones, progress log, repos", () => {
  function withProject() {
    const home = initialized();
    lib.addDepartment(home, { id: "pm" });
    const file = path.join(home, "departments", "pm", "projects", "app.md");
    fs.writeFileSync(file, [
      "# アプリ",
      "",
      "## マイルストーン",
      "",
      "### 公開まで",
      `- [ ] 審査に出す（期限: ${today}）`,
      `- [x] 計測を入れる（期限: ${yesterday}）（済み）`,
      `- [ ] 課題を直す（期限: ${yesterday}）（メモつき）`,
      "",
      "## 進捗ログ",
      "",
      "- 2026-09-01: 開始",
      "",
    ].join("\n"));
    return { home, file };
  }

  test("parse milestones, including notes after the due date", () => {
    const { home } = withProject();
    const { milestones } = lib.listProjects(home, { project: "app" });
    assert.deepEqual(milestones.map((m) => [m.n, m.status, m.text, m.due, m.section]), [
      [1, "open", "審査に出す", today, "公開まで"],
      [2, "done", "計測を入れる （済み）", yesterday, "公開まで"],
      [3, "open", "課題を直す （メモつき）", yesterday, "公開まで"],
    ]);
    const upcoming = lib.upcomingMilestones(home);
    assert.deepEqual(upcoming.map((m) => [m.text, m.overdue]), [["課題を直す （メモつき）", true], ["審査に出す", false]]);
    assert.equal(lib.listProjects(home).projects[0].next.text, "課題を直す （メモつき）");
  });

  test("add, done, due, log", () => {
    const { home, file } = withProject();
    const added = lib.addMilestone(home, { project: "app", text: "スクショを作る", due: "+2", section: "公開まで" });
    assert.equal(added.added, true);
    assert.equal(lib.addMilestone(home, { project: "app", text: "スクショを作る", due: "+2" }).added, false);
    lib.addMilestone(home, { project: "app", text: "週次の数字を見る", due: "+10", section: "公開後" });
    let content = fs.readFileSync(file, "utf8");
    assert.ok(content.indexOf("スクショを作る") < content.indexOf("### 公開後"), "added under 公開まで");
    assert.ok(content.indexOf("### 公開後") < content.indexOf("## 進捗ログ"), "new subsection stays inside milestones");

    lib.setMilestoneDone(home, { project: "app", target: "審査" });
    const due = lib.setMilestoneDue(home, { project: "app", target: "課題", due: "+5" });
    assert.equal(due.to, lib.addDays(today, 5));
    lib.addProgressLog(home, { project: "app", text: "審査に出した" });
    content = fs.readFileSync(file, "utf8");
    assert.match(content, /- \[x\] 審査に出す/);
    assert.match(content, new RegExp(`課題を直す（期限: ${lib.addDays(today, 5)}）（メモつき）`));
    assert.ok(content.trimEnd().endsWith(`- ${today}: 審査に出した`));
    assert.throws(() => lib.setMilestoneDone(home, { project: "app", target: "審査" }), /ありません/);
    assert.throws(() => lib.addMilestone(home, { project: "app", text: "期限なし" }), /期限が必要/);
    assert.throws(() => lib.listProjects(home, { project: "nothing" }), /ありません/);
  });

  test("CLI pm commands", () => {
    const { home } = withProject();
    assert.equal(cli(home, "pm", "add", "app", "LPを作る", "--due", "+3").json.added, true);
    assert.equal(cli(home, "pm", "done", "app", "LP").code, 0);
    assert.equal(cli(home, "pm", "log", "app", "LPを公開").code, 0);
    const list = cli(home, "pm", "list", "app");
    assert.ok(list.json.milestones.some((m) => m.text === "LPを作る" && m.status === "done"));
  });

  test("link a git repository and read recent activity", { skip: spawnSync("git", ["--version"]).status !== 0 }, () => {
    const { home } = withProject();
    const repo = path.join(path.dirname(home), "repo");
    fs.mkdirSync(repo);
    const git = (...args) => spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" });
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "status: 計画をユーザーへ");
    git("commit", "-q", "--allow-empty", "-m", "status: ユーザーの答えを反映");
    assert.throws(() => lib.linkRepo(home, { project: "app", repo: path.dirname(home) }), /git のリポジトリではありません/);
    lib.linkRepo(home, { project: "app", repo });
    assert.equal(lib.readConfig(home).repos.app, path.resolve(repo));
    const [activity] = lib.devActivity(home, { hours: 1 });
    assert.equal(activity.commits.length, 2);
    assert.deepEqual(activity.waiting.map((commit) => commit.subject), ["status: 計画をユーザーへ"]);
    const brief = lib.buildBrief(home, {});
    assert.match(brief.markdown, /## 開発の動き/);
    assert.match(brief.markdown, /確認待ちかもしれません/);
  });

  test("config rejects malformed repos", () => {
    const home = initialized();
    const file = path.join(home, "config.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...config, repos: { "Bad Id": "x" } }));
    assert.throws(() => lib.readConfig(home), /repos が不正/);
  });
});

describe("ideas", () => {
  test("idea records appear on the dashboard state", () => {
    const home = initialized();
    lib.addDepartment(home, { id: "research" });
    const dir = path.join(home, "departments", "research", "ideas");
    assert.ok(fs.existsSync(dir), "research preset creates ideas/");
    fs.writeFileSync(path.join(dir, "a.md"), `---\nname: "案A"\nstatus: "検証中"   # 状態\nstage: 1\nupdated: "2026-10-01"\n---\n\n# 案A\n`);
    fs.writeFileSync(path.join(dir, "b.md"), "# 案B（frontmatter なし）\n");
    const ideas = lib.dashboardState(home).ideas;
    assert.deepEqual(ideas.map((idea) => [idea.id, idea.name, idea.status, idea.stage]), [["a", "案A", "検証中", 1], ["b", "案B（frontmatter なし）", null, null]]);
  });

  test("marketing preset carries the copy rules", () => {
    const home = initialized();
    lib.addDepartment(home, { id: "marketing" });
    const rules = fs.readFileSync(path.join(home, "departments", "marketing", "RULES.md"), "utf8");
    assert.match(rules, /他社のアプリ名・サービス名を使わない/);
    assert.match(rules, /商用利用できるもの/);
  });
});
