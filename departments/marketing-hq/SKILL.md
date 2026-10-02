---
name: marketing-hq
description: AI秘書のマーケティング部（司令塔）。自分のiOS・Webアプリの集客・SNS・ASO・収益化の相談の入口。アプリの前提情報（ターゲット・競合・料金）の登録、SNS投稿の実績記録と「どの型が効いたか」の集計、計測用App Storeリンク（ct）の発行、目的に合う専門スキルへの振り分けを行う。「集客」「マーケ」「アプリを広めたい」「投稿した」「再生数を記録」「どの投稿が効いた」「計測リンク」「アプリを登録」などで使う。
---

# マーケティング部（司令塔）

AI秘書（secretary スキル）の組織に属する部署。記録は AI秘書のデータフォルダの `departments/marketing/` に残す。

## コマンド

```
node "$HOME/.claude/skills/marketing-hq/scripts/growth.mjs" <コマンド>
node "$HOME/.claude/skills/secretary/scripts/secretary.mjs" <コマンド>
```

`growth.mjs` の主なコマンド（`--help` で全体を表示）:

| コマンド | 用途 |
|---|---|
| `app list` / `app init <ID> --name <名前>` / `app set <ID> --app-store-id <数字> --provider-token <pt>` | アプリの登録と更新 |
| `post add --channel tiktok --format スライド --hook "..." [--app <ID>]` | 投稿を記録し、計測リンクを発行 |
| `post update <投稿ID> --views 1.2万 --page-views 35 --installs 4` | あとから数字を記録 |
| `post summary [--days 30]` | チャネル別・形式別の成績と上位投稿 |
| `link --ct <キャンペーン名>` | 計測リンクだけ作る |
| `week` | 今週・先週の日付範囲（週次レポート用） |

## 最初に確認すること

1. `secretary.mjs status` で初期化を確認する（未初期化なら secretary スキルの初回セットアップへ）。
2. `departments` に `marketing` がなければ「マーケティング部を作ります」と伝えて `secretary.mjs dept add marketing` を実行する。
3. `growth.mjs app list` でアプリを確認する。0件なら下の「アプリの登録」を行う。

## アプリの登録（前提情報づくり）

1. `app init <英字ID> --name <アプリ名>` でファイル（`apps/<ID>.md`）を作る。
2. 空欄の見出しを埋めるため、1つずつ質問する。アプリのリポジトリや README、App Store のページ（review-insights スキルの `reviews.mjs lookup <ID>`）から分かることは先に読み、質問を減らす。質問の観点は `product-marketing` と `app-marketing-context` スキルを参考にする。
3. 埋まった内容を Edit ツールでファイルに書く。App Store ID と providerToken（pt）は `app set` で登録する。
   - pt の場所: App Store Connect →「アプリ分析」→「キャンペーン」→ キャンペーンリンクを作成すると URL に `pt=数字` が入っている。
4. **このファイルがアプリの前提情報の正本**。他のスキル（`.agents/product-marketing.md` や `app-marketing-context.md` を探すもの）を使うときは、先にこのファイルを読んで内容を渡し、同じ質問をくり返さない。アプリのリポジトリにそれらのファイルが必要なときは、このファイルから作ってよいか聞いてから作る。

## 公開前と公開後（stage）

アプリには段階がある（`app list` の `stage`）。`app init` の既定は `prelaunch`（公開前）。

| | 公開前（prelaunch） | 公開後（live） |
|---|---|---|
| 目標 | ファンと事前登録を集め、当たる投稿の型を見つけておく | インストールと課金を増やす |
| 受け皿 | App Store の予約注文（審査通過が必要・公開の最大180日前から）／TestFlight の公開リンク／事前登録ページ | App Store のページ |
| 投稿ログの「ページ訪問」 | 予約ページ・事前登録ページ・TestFlight ページへの訪問 | App Store ページへの訪問（ct 別） |
| 投稿ログの「インストール」 | **事前登録数**（予約・ベータ参加・ウェイトリスト登録） | インストール数 |
| 主に使うスキル | `launch`、`content-strategy`、`sns-daily`、`review-insights`、`keyword-research`、`screenshot-optimization`、`monetization-strategy` | 下の振り分け表すべて |

**公開したら**: `app set <ID> --stage live --app-store-id <数字> --provider-token <pt>` に切り替え、秘書に「asc の導入」と「定期実行の見直し」を提案する（ページ訪問・流入元の自動集計は公開後に意味を持つため）。

## 投稿の記録（学習ループ）

- ユーザーが「投稿した」と言ったら `post add` で記録し、返ってきた計測リンクを伝える（プロフィールのリンクや固定コメントに使う）。
- 「〇〇の再生が1.2万だった」などと言われたら `post update` で数字を入れる。ページ訪問数は App Store Connect の「アプリ分析 → キャンペーン」で ct ごとに見られることを伝える。
- 「どれが効いた？」と聞かれたら `post summary` を実行し、**再生数ではなくページ訪問・インストールにつながった型**を中心に説明する。

## 専門スキルへの振り分け

| やりたいこと | 使うスキル |
|---|---|
| 毎日の投稿案・台本 | `sns-daily`（中で `social` を参照） |
| AI動画・Remotion での動画制作 | `video` |
| クリエイター／UGC 施策 | `creator-ugc-marketing` |
| 発信テーマ・柱の設計 | `content-strategy` |
| 集客アイデア出し／90日計画 | `marketing-ideas` / `marketing-plan` |
| リリースや新機能の告知 | `launch` |
| App Store ページの診断 | `aso-audit`（asc CLI が使えれば `asc-aso-audit` も） |
| キーワード → タイトル・説明文 | `keyword-research` → `metadata-optimization` |
| スクショ・プレビュー動画 | `screenshot-optimization` / `app-preview-video` |
| SNS投稿ごとの専用ページ | `custom-product-pages` |
| 競合・レビュー分析 | `review-insights`（＋`competitor-analysis`） |
| レビュー返信・評価を上げる | `review-management` / `rating-prompt-strategy` |
| 価格・課金画面 | `monetization-strategy` / `paywall-optimization`（実装は `revenuecat-paywall`、テストは `revenuecat-experiments`） |
| オンボーディング | `onboarding-optimization` |
| 継続率・解約 | `retention-optimization` / `subscription-lifecycle` |
| 招待・紹介 | `referral-program` |
| Web → アプリ、Web決済 | `web-to-app-funnel`（決済の実装は stripe 系スキル） |
| 説明文・LP・広告の文章 | `copywriting` / `marketing-psychology` |
| A/Bテストの設計、Webの計測 | `ab-testing` / `analytics` |
| ストア情報の更新・多言語化・国別価格・リリース | `asc-metadata-sync` / `asc-localize-metadata` / `asc-ppp-pricing` / `asc-release-flow`（asc CLI が必要） |
| 週次の数字の振り返り | `growth-report` |

専門スキルの成果物（企画・分析・計画）は `departments/marketing/` の該当フォルダ（`content/` `campaigns/` `reports/`）に保存し、保存先を伝える。決めたことは `secretary.mjs decision add`、やることは `secretary.mjs todo add` に残す。

## 守ること

- **投稿ボタンは人が押す。** SNSへの自動投稿や、SNSからのデータ抜き出し（スクレイピング）は行わない。
- 企業案件やクリエイターに依頼した投稿には必ず「PR」「広告」などの表記を入れる（ステルスマーケティング規制）。
- 「No.1」「必ず痩せる」など根拠のない表現、架空のレビューや体験談は作らない（景品表示法）。
- APIキーやパスワードは記録しない。必要なときはユーザー自身に設定してもらう。
