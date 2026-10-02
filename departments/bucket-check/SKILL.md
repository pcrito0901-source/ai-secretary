---
name: bucket-check
description: AI秘書の分析部。自分のアプリの数字（App Store Connect・RevenueCat・PostHog）を週ごとに集めて記録し、「集客 → 活性化 → 継続 → 紹介 → 収益」のバケツのどこに穴が開いているかを診断して、改善ボードで打ち手と結果を管理する。「バケツ見て」「どこで離脱してる？」「数字を更新して」「改善の結果は？」「継続率」「課金率」や週次の定期実行で使う。
---

# バケツ診断（分析部）

AI秘書（secretary スキル）の組織に属する部署。数字を見て穴を見つけ、打ち手を決め、効いたかを確かめるまでを管理する。グラフそのものは PostHog・RevenueCat の管理画面に任せ、ここでは**判断と記録**を担う。

## コマンド

```
node "$HOME/.claude/skills/bucket-check/scripts/metrics.mjs" <apps|show|record|week|validate> ...
node "$HOME/.claude/skills/secretary/scripts/secretary.mjs" <コマンド>
```

## ファイル（`departments/analytics/apps/<アプリID>/`）

| ファイル | 中身 | 書き方 |
|---|---|---|
| `bucket.md` | バケツの設計図。段階ごとの指標、**どこからどう取るか**（PostHog のイベント名・HogQL・インサイトID、RevenueCat のグラフ名、App Store Connect のレポート） | Edit ツールで更新 |
| `metrics.json` | 指標の定義（ID・名前・単位・段階・目標）とファネル、週ごとの数字 | 定義は Edit、**数字は必ず `record` で**記録 |
| `experiments.md` | 改善ボード（候補／実施中／終了） | Edit ツールで更新 |

週ごとの診断は `departments/analytics/reports/<アプリID>-<YYYY-Www>.md`。

## 最初に確認すること

1. `secretary.mjs status` で初期化と部署を確認する。`analytics` 部署がなければ「分析部を作ります」と伝えて `secretary.mjs dept add analytics`。
2. `metrics.mjs apps` で指標のあるアプリを確認する。対象アプリに `metrics.json` がなければ、下の「新しいアプリの設計図」を行う。
3. 使えるデータの接続を確認する（使えないものは「未取得」として進める）。
   - **App Store Connect**: `appstore` の MCP ツール（`download-sales-report` など）
   - **RevenueCat**: RevenueCat の MCP と `revenuecat-charts` スキル。未認証なら「/mcp から RevenueCat にサインインしてください」と案内
   - **PostHog**: PostHog のコネクタ（`query-run`・`insight-query` など）。未接続なら接続を案内
   - **ページの表示数・成約率**: asc CLI の `asc-analytics-reports`（導入後）。なければ App Store Connect の画面の数字をユーザーに聞く

## 診断の手順

1. **対象の週を決める。** 指定がなければ「先週（月〜日）」＝ `metrics.mjs week --date <7日前>`。
2. `bucket.md` を読み、指標ごとの取り方に従って数字を集める。
   - PostHog の人数は、その週にイベントを起こした人の数で数える（例）:
     `SELECT count(DISTINCT person_id) FROM events WHERE event = 'item_created' AND timestamp >= toDateTime('2026-09-28') AND timestamp < toDateTime('2026-10-05')`
   - 継続率は PostHog の retention インサイトを使う（ID を `bucket.md` に控えておく）。
   - **取れなかった数字は推測で埋めない。** 記録せず、レポートに「未取得」と理由を書く。
3. `metrics.mjs record <アプリID> --period <週> --values "id=数字,..." --note "<取得元や注意>"` で記録する。
4. `metrics.mjs show <アプリID> --period <週>` で、前週比・各段階の通過率・一番の穴（`biggestLeak`）・悪化した段階（`worsened`）を確認する。
5. **診断する。** 数字だけでなく理由の仮説を立てる。
   - 一番の穴と、先週より悪化した段階を優先する。目標（`target`）を下回る指標も見る。
   - **分母が小さいとき（目安: 30人未満）は割合で断定しない。** 「傾向」として扱い、レビュー・問い合わせ・知人の声と合わせて判断する。
   - 実施中の実験（`experiments.md` の「実施中」）があれば、その指標が期待どおり動いたかを評価する。
6. **打ち手を決める。** 穴の段階に合う専門スキルの考え方を使う。

   | 穴の段階 | 使うスキル |
   |---|---|
   | ストアのページ → インストール | `screenshot-optimization`、`metadata-optimization`、`custom-product-pages` |
   | インストール → 最初の価値体験（活性化） | `onboarding-optimization` |
   | 継続 | `retention-optimization` |
   | 紹介・招待 | `referral-program` |
   | 課金画面 → 無料体験 → 有料 | `paywall-optimization`、`monetization-strategy`、`subscription-lifecycle`（実装は `revenuecat-paywall`、テストは `revenuecat-experiments`） |
   | 実験の設計 | `ab-testing` |

7. **改善ボードを更新する**（`experiments.md`）。新しい打ち手は「候補」に、ICE（効果・確信度・手軽さを各1〜10）を付けて並べる。
8. **レポートを保存する**（`reports/<アプリID>-<週>.md`）:

```
# バケツ診断 <アプリ名> <週>（<開始>〜<終了>）

## 数字（前週比）
## 一番の穴と、その理由（仮説）
## 悪化したところ
## 実施中の改善の結果
## 次にやること（最大3つ・ICE・担当スキル）
## 未取得のデータと取り方
```

9. **つなげる。** 決めた重点は `secretary.mjs decision add`。実装が必要な打ち手は、ユーザーの了承を得て PM のマイルストーン（`departments/pm/projects/<アプリ>.md`）に追加し、必要なら開発部に指示書を作る。
10. 要点（大きな変化、一番の穴、次にやること）を短く伝え、ダッシュボードの「アプリの数字」で見られることを添える。

**定期実行（ユーザー不在）で動いているときは質問しない。** 取れる数字だけで記録・診断し、TODO は「バケツ診断を確認: reports/<ファイル>」の1件だけ追加する。

## 新しいアプリの設計図

1. `departments/analytics/apps/<アプリID>/` に `bucket.md`・`metrics.json`・`experiments.md` を作る（既存のアプリのファイルを手本にする）。
2. 段階は「集客・活性化・継続・紹介・収益」を基本に、そのアプリの**コアの価値**（例: 写真共有アプリなら「頼んだ写真が返ってくる割合」）を必ず1つ入れる。
3. PostHog に実際に送られているイベント名を確認し（PostHog のイベント一覧、またはアプリのコード）、`bucket.md` に取り方を書く。分からないものは「要確認」と書き、推測のイベント名で数字を取らない。
4. `metrics.mjs validate <アプリID>` で定義を確認する。

## 守ること

- 数字は取得元（どの画面・どのクエリ）が分かるように記録する。
- 個人を特定できる情報（メール、名前、端末ID）は記録しない。人数と割合だけを残す。
- APIキーやトークンは記録しない。接続はユーザー自身にしてもらう。
