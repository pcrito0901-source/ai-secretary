import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as lib from "../secretary/scripts/lib.mjs";
import * as growth from "../departments/marketing-hq/scripts/growth.mjs";
import { parseReviewFeed, summarizeReviews } from "../departments/review-insights/scripts/reviews.mjs";

const GROWTH_CLI = fileURLToPath(new URL("../departments/marketing-hq/scripts/growth.mjs", import.meta.url));
const temps = [];
after(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function home({ marketing = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-secretary-dept-"));
  temps.push(dir);
  const root = path.join(dir, "home");
  lib.init(root, { business: "個人でiOSアプリ開発", goals: "SNSで集客" });
  if (marketing) lib.addDepartment(root, { id: "marketing" });
  return root;
}

const today = lib.formatDate();

describe("marketing-hq: apps", () => {
  test("requires the marketing department", () => {
    assert.throws(() => growth.listApps(home({ marketing: false })), /dept add marketing/);
  });

  test("init, list, set and single-app default", () => {
    const root = home();
    const created = growth.initApp(root, { slug: "habit", name: "習慣アプリ" });
    assert.equal(created.created, true);
    assert.match(fs.readFileSync(created.file, "utf8"), /## 誰のためのアプリか/);
    assert.equal(growth.initApp(root, { slug: "habit", name: "別名" }).created, false);

    growth.setApp(root, { slug: "habit", appStoreId: "1234567890", providerToken: "118000" });
    const [app] = growth.listApps(root);
    assert.deepEqual([app.slug, app.name, app.appStoreId, app.providerToken, app.country], ["habit", "習慣アプリ", "1234567890", "118000", "jp"]);
    assert.ok(app.unfilledSections > 5);
    assert.match(fs.readFileSync(app.file, "utf8"), /# 習慣アプリ — マーケティングの前提/, "body survives frontmatter rewrite");

    assert.throws(() => growth.setApp(root, { slug: "habit", appStoreId: "abc" }), /数字/);
    assert.throws(() => growth.initApp(root, { slug: "Bad Slug", name: "x" }), /英小文字/);
  });

  test("stage defaults to prelaunch and can be switched to live", () => {
    const root = home();
    growth.initApp(root, { slug: "habit", name: "習慣アプリ" });
    assert.equal(growth.listApps(root)[0].stage, "prelaunch");
    assert.match(growth.addPost(root, { channel: "x", format: "開発ストーリー", hook: "作ってます" }).warning, /公開前/);
    growth.setApp(root, { slug: "habit", stage: "live", appStoreId: "1234567890", providerToken: "118000" });
    assert.equal(growth.listApps(root)[0].stageLabel, "公開後");
    assert.equal(growth.addPost(root, { channel: "x", format: "f", hook: "公開しました" }).warning, null);
    assert.throws(() => growth.setApp(root, { slug: "habit", stage: "beta" }), /prelaunch/);
  });

  test("tracking links include pt and ct, and warn when pt is missing", () => {
    const withPt = growth.trackingLink({ appStoreId: "1234567890", country: "jp", providerToken: "118000" }, "tiktok-20260924-1");
    assert.equal(withPt.link, "https://apps.apple.com/jp/app/id1234567890?pt=118000&ct=tiktok-20260924-1");
    assert.equal(withPt.warning, null);
    assert.match(growth.trackingLink({ appStoreId: "1234567890", country: "jp", providerToken: "" }, "x").warning, /providerToken/);
    assert.equal(growth.trackingLink({ appStoreId: "", country: "jp" }, "x").link, null);
  });
});

describe("marketing-hq: post log", () => {
  test("parseCount understands Japanese and k/m units", () => {
    assert.equal(growth.parseCount("1.2万", "再生"), 12000);
    assert.equal(growth.parseCount("3k", "再生"), 3000);
    assert.equal(growth.parseCount("1,234", "再生"), 1234);
    assert.equal(growth.parseCount("", "再生"), null);
    assert.throws(() => growth.parseCount("たくさん", "再生"), /数字/);
  });

  test("add, update, summary rank by page views not just views", () => {
    const root = home();
    growth.initApp(root, { slug: "habit", name: "習慣アプリ" });
    growth.setApp(root, { slug: "habit", appStoreId: "1234567890", providerToken: "118000" });

    const first = growth.addPost(root, { channel: "TikTok", format: "スライド", hook: "三日坊主の人へ | 秘密" });
    assert.equal(first.post.id, `${today.replace(/-/g, "")}-1`);
    assert.match(first.link, /ct=tiktok-\d{8}-1/);
    const second = growth.addPost(root, { channel: "リール", format: "画面録画", hook: "3秒で記録", views: "5万", pageViews: "20" });
    assert.equal(second.post.channel, "instagram");
    growth.addPost(root, { channel: "x", format: "開発ストーリー", hook: "個人開発1か月" });

    growth.updatePost(root, { id: first.post.id, views: "8000", pageViews: "60", installs: "9", note: "コメント多い" });
    const log = fs.readFileSync(path.join(root, "departments", "marketing", "post-log.md"), "utf8");
    assert.match(log, /三日坊主の人へ ｜ 秘密/, "pipes are escaped so the table stays intact");

    const summary = growth.summarizePosts(root, { days: 7 });
    assert.equal(summary.posts, 3);
    assert.equal(summary.topByPageViews[0].id, first.post.id, "fewer views but more page visits ranks first");
    assert.equal(summary.byFormat[0].format, "スライド");
    assert.equal(summary.unmeasured.length, 1);
    assert.equal(summary.totals.views, 58000);

    assert.throws(() => growth.updatePost(root, { id: "20990101-1", views: "1" }), /ログにありません/);
    assert.throws(() => growth.addPost(root, { channel: "mixi", format: "x", hook: "y" }), /チャネル/);
  });

  test("multiple apps require --app", () => {
    const root = home();
    growth.initApp(root, { slug: "a", name: "A" });
    growth.initApp(root, { slug: "b", name: "B" });
    assert.throws(() => growth.addPost(root, { channel: "x", format: "f", hook: "h" }), /複数/);
    assert.equal(growth.addPost(root, { app: "b", channel: "x", format: "f", hook: "h" }).post.app, "b");
  });

  test("CLI accepts kebab-case metric options", () => {
    const root = home();
    growth.initApp(root, { slug: "habit", name: "習慣アプリ" });
    const run = (...args) => spawnSync(process.execPath, [GROWTH_CLI, ...args, `--home=${root}`], { encoding: "utf8" });
    const added = run("post", "add", "--channel", "tiktok", "--format", "スライド", "--hook", "テスト", "--page-views", "12");
    assert.equal(added.status, 0, added.stderr);
    assert.equal(JSON.parse(added.stdout).post.pageViews, 12);
    const typo = run("post", "add", "--chanel", "tiktok");
    assert.equal(typo.status, 1);
    assert.match(typo.stderr, /--chanel は使えません/);
  });
});

describe("marketing-hq: weeks", () => {
  test("ISO weeks across year boundaries", () => {
    assert.equal(growth.isoWeek("2026-01-01").week, "2026-W01");
    assert.equal(growth.isoWeek("2025-12-29").week, "2026-W01");
    assert.equal(growth.isoWeek("2027-01-01").week, "2026-W53");
    const week = growth.isoWeek("2026-09-24");
    assert.deepEqual([week.week, week.start, week.end, week.previousStart], ["2026-W39", "2026-09-21", "2026-09-27", "2026-09-14"]);
  });
});

describe("bucket-check: weekly metrics", () => {
  const METRICS_CLI = fileURLToPath(new URL("../departments/bucket-check/scripts/metrics.mjs", import.meta.url));

  function withMetrics() {
    const root = home({ marketing: false });
    lib.addDepartment(root, { id: "analytics" });
    const dir = path.join(root, "departments", "analytics", "apps", "demo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "metrics.json"), JSON.stringify({
      name: "デモ",
      metrics: [
        { id: "installs", label: "インストール", unit: "count", stage: "集客" },
        { id: "signups", label: "アカウント作成", unit: "count", stage: "活性化" },
        { id: "first_post", label: "初めての投稿", unit: "count", stage: "活性化" },
        { id: "d7_retention", label: "7日後の継続率", unit: "percent", stage: "継続", kpi: true, target: 30 },
        { id: "mrr", label: "月の売上", unit: "yen", stage: "収益", kpi: true },
      ],
      funnels: [{ label: "活性化", steps: ["installs", "signups", "first_post"] }],
      snapshots: [],
    }));
    fs.writeFileSync(path.join(dir, "experiments.md"), "# 改善ボード\n\n## 実施中\n\n### E-001 オンボーディング短縮\n\n## 候補\n\n### E-002 招待画面\n");
    return root;
  }

  test("weekOf handles year boundaries", () => {
    assert.deepEqual(lib.weekOf("2026-09-25"), { period: "2026-W39", start: "2026-09-21", end: "2026-09-27" });
    assert.equal(lib.weekOf("2027-01-01").period, "2026-W53");
    assert.equal(lib.weekOf("2025-12-29").period, "2026-W01");
  });

  test("record merges values per week and rejects bad input", () => {
    const root = withMetrics();
    lib.recordSnapshot(root, "demo", { period: "2026-W40", values: { installs: 200, signups: 120 } });
    const merged = lib.recordSnapshot(root, "demo", { period: "2026-W40", values: { first_post: 30 }, note: "PostHog から取得" });
    assert.deepEqual(merged.snapshot.values, { installs: 200, signups: 120, first_post: 30 });
    assert.equal(merged.snapshot.start, "2026-09-28");
    assert.throws(() => lib.recordSnapshot(root, "demo", { period: "2026-W40", values: { unknown: 1 } }), /定義されていません/);
    assert.throws(() => lib.recordSnapshot(root, "demo", { period: "2026-W40", values: { d7_retention: 140 } }), /0〜100/);
    assert.throws(() => lib.recordSnapshot(root, "demo", { period: "2026-W99", values: { installs: 1 } }), /存在しない週/);
    assert.throws(() => lib.readMetrics(root, "nope"), /まだ定義されていません/);
  });

  test("summary finds the biggest leak, worsened steps, pt changes and targets", () => {
    const root = withMetrics();
    lib.recordSnapshot(root, "demo", { period: "2026-W39", values: { installs: 100, signups: 70, first_post: 40, d7_retention: 35, mrr: 1000 } });
    lib.recordSnapshot(root, "demo", { period: "2026-W40", values: { installs: 200, signups: 120, first_post: 30, d7_retention: 28.5, mrr: 1500 } });
    const summary = lib.summarizeMetrics(root, "demo");
    assert.equal(summary.period, "2026-W40");
    assert.equal(summary.previousPeriod, "2026-W39");
    const steps = summary.funnels[0].steps;
    assert.deepEqual(steps.map((step) => step.conversion), [null, 60, 25]);
    assert.deepEqual(summary.biggestLeak, { funnel: "活性化", from: "アカウント作成", to: "初めての投稿", conversion: 25, previousConversion: 57.1 });
    assert.equal(summary.worsened[0].to, "初めての投稿");
    const retention = summary.metrics.find((metric) => metric.id === "d7_retention");
    assert.deepEqual(retention.change, { type: "pt", value: -6.5 });
    assert.equal(retention.belowTarget, true);
    assert.deepEqual(summary.metrics.find((metric) => metric.id === "mrr").change, { type: "percent", value: 50 });
    assert.deepEqual(summary.experiments, ["E-001 オンボーディング短縮"]);
    assert.equal(lib.dashboardState(root).analytics[0].biggestLeak.to, "初めての投稿");
  });

  test("invalid definitions are reported per app instead of breaking the dashboard", () => {
    const root = withMetrics();
    const bad = path.join(root, "departments", "analytics", "apps", "broken");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, "metrics.json"), JSON.stringify({ metrics: [{ id: "x", label: "X", unit: "count" }], funnels: [{ label: "f", steps: ["x", "missing"] }] }));
    const state = lib.analyticsState(root);
    assert.match(state.find((app) => app.app === "broken").error, /missing/);
    assert.equal(state.find((app) => app.app === "demo").error, undefined);
  });

  test("CLI records values from key=value pairs", () => {
    const root = withMetrics();
    const run = (...args) => spawnSync(process.execPath, [METRICS_CLI, ...args, `--home=${root}`], { encoding: "utf8" });
    const recorded = run("record", "demo", "--period", "2026-W40", "--values", "installs=10, signups=4");
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.equal(JSON.parse(run("show", "demo").stdout).funnels[0].steps[1].conversion, 40);
    const bad = run("record", "demo", "--values", "installs:10");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /指標ID=数字/);
  });
});

describe("review-insights: feed parsing", () => {
  const feed = {
    feed: {
      entry: [
        { "im:name": { label: "App itself (old feed format)" } },
        { id: { label: "1" }, "im:rating": { label: "1" }, title: { label: "同期が消えた" }, content: { label: "データが消えました", attributes: { type: "text" } }, "im:version": { label: "2.0" }, updated: { label: "2026-09-20T10:00:00-07:00" }, author: { name: { label: "山田" } } },
        { id: { label: "2" }, "im:rating": { label: "5" }, title: { label: "最高" }, content: [{ label: "毎日使ってます" }], "im:version": { label: "2.1" }, updated: { label: "2026-09-22T10:00:00-07:00" } },
      ],
    },
  };

  test("skips non-review entries and drops reviewer names", () => {
    const reviews = parseReviewFeed(feed);
    assert.equal(reviews.length, 2);
    assert.deepEqual(reviews[0], { id: "1", rating: 1, title: "同期が消えた", body: "データが消えました", version: "2.0", date: "2026-09-20" });
    assert.equal(reviews[1].body, "毎日使ってます");
    assert.equal(JSON.stringify(reviews).includes("山田"), false);
  });

  test("single-entry and empty feeds", () => {
    assert.equal(parseReviewFeed({ feed: { entry: feed.feed.entry[1] } }).length, 1);
    assert.deepEqual(parseReviewFeed({ feed: {} }), []);
    assert.deepEqual(parseReviewFeed(null), []);
  });

  test("summary distribution and averages", () => {
    const summary = summarizeReviews(parseReviewFeed(feed));
    assert.equal(summary.average, 3);
    assert.deepEqual(summary.distribution, { 1: 1, 2: 0, 3: 0, 4: 0, 5: 1 });
    assert.equal(summary.from, "2026-09-20");
    assert.equal(summary.to, "2026-09-22");
  });
});

describe("department skills: SKILL.md", () => {
  const root = fileURLToPath(new URL("../departments/", import.meta.url));
  const skills = fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, "SKILL.md")));

  test("every department skill names itself after its folder", () => {
    assert.ok(skills.includes("idea-check"));
    for (const name of skills) {
      const text = fs.readFileSync(path.join(root, name, "SKILL.md"), "utf8");
      const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      assert.ok(front, `${name}: frontmatter`);
      assert.match(front[1], new RegExp(`^name: ${name}$`, "m"), `${name}: name`);
      assert.match(front[1], /^description: .{20,}$/m, `${name}: description`);
    }
  });

  test("references linked from SKILL.md exist", () => {
    for (const name of skills) {
      const text = fs.readFileSync(path.join(root, name, "SKILL.md"), "utf8");
      for (const [, ref] of text.matchAll(/`(references\/[^`]+\.md)`/g)) {
        assert.ok(fs.existsSync(path.join(root, name, ref)), `${name}: ${ref}`);
      }
    }
  });
});

describe("installed as separate skill folders", () => {
  test("department scripts find the secretary scripts when skills sit side by side", () => {
    const repo = fileURLToPath(new URL("../", import.meta.url));
    const skills = fs.mkdtempSync(path.join(os.tmpdir(), "ai-secretary-skills-"));
    temps.push(skills);
    fs.cpSync(path.join(repo, "secretary"), path.join(skills, "secretary"), { recursive: true });
    for (const name of ["marketing-hq", "bucket-check", "review-insights"]) {
      fs.cpSync(path.join(repo, "departments", name), path.join(skills, name), { recursive: true });
    }
    const runs = [
      ["marketing-hq/scripts/growth.mjs", /マーケティング部 CLI/],
      ["bucket-check/scripts/metrics.mjs", /./],
      ["review-insights/scripts/reviews.mjs", /レビュー調査 CLI/],
    ];
    for (const [script, expected] of runs) {
      const result = spawnSync(process.execPath, [path.join(skills, script), "--help"], { encoding: "utf8", env: { ...process.env, AI_SECRETARY_SCRIPTS: "" } });
      assert.equal(result.status, 0, `${script}: ${result.stderr}`);
      assert.match(result.stdout, expected, script);
    }
  });

  test("optional dashboard cards follow the departments", () => {
    const dir = home({ marketing: false });
    assert.deepEqual(lib.dashboardState(dir).features, { analytics: false, ideas: false });
    lib.addDepartment(dir, { id: "analytics" });
    lib.addDepartment(dir, { id: "research" });
    assert.deepEqual(lib.dashboardState(dir).features, { analytics: true, ideas: true });
  });
});
