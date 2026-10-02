---
name: growth-report
description: AI秘書マーケティング部の週次の数字の振り返り。SNS投稿ログ、App Store Connect（ダウンロード・売上・ページの成約率）、RevenueCat（無料体験・課金・解約）をまとめ、「SNS → ページ → インストール → 課金」のどこが弱いかを特定して、来週の打ち手を決める。「週次レポート」「今週の数字」「振り返り」「どこが弱い？」や定期実行で使う。
---

# 週次グロースレポート（マーケティング部）

役割分担: このスキルは**集客（SNS・ストアのページ）**が中心。アプリ内の行動（活性化・継続・紹介）と課金まで含めたバケツ全体の診断は、分析部の `bucket-check` が担当する。両方を見るときは、`bucket-check` の最新の診断（`departments/analytics/reports/`）を読んでから、集客の打ち手に集中する。

コマンド:

```
node "$HOME/.claude/skills/marketing-hq/scripts/growth.mjs" <コマンド>
node "$HOME/.claude/skills/secretary/scripts/secretary.mjs" <コマンド>
```

**定期実行で動いているときは質問しない。** 取れなかったデータは「未取得」として理由と取り方を書く。数字を推測で埋めない。

## 手順

1. `secretary.mjs status`、`growth.mjs app list`、`growth.mjs week` を実行する。週次レポートは `week` の `start`〜`end`（先週比は `previousStart`〜`previousEnd`）を対象にする。金曜などの週の途中なら「週の途中まで」と明記する。
2. データを集める（使えるものだけ）。
   - **SNS**: `growth.mjs post summary --app <ID> --days 7` と `--days 28`。`unmeasured` にある投稿は数字の記入漏れとして一覧にする。
   - **ダウンロード・売上**: App Store Connect 連携の売上レポート（`download-sales-report`）。使えなければ未取得。
   - **ページ訪問・成約率・流入元（キャンペーン別）**: asc CLI が使えれば `asc-analytics-reports`。使えなければ、会話中は App Store Connect の「アプリ分析」の数字を貼ってもらう。定期実行なら未取得。
   - **無料体験・課金・解約・MRR**: `revenuecat-charts` スキル。RevenueCat 連携が未認証なら未取得とし、「/mcp で RevenueCat を認証すると取得できます」と書く。
   - **公開前（`stage: prelaunch`）のアプリ**では、App Store と RevenueCat の数字は使わず、代わりに次を集める: 投稿ログの「ページ訪問」「インストール（＝事前登録数）」、予約注文数（予約開始済みなら App Store Connect）、TestFlight のテスター数（App Store Connect 連携の beta testers）、事前登録ページの登録数とフォロワー数（会話中は聞く／定期実行なら未取得）。
3. ファネルにして、一番弱い段階を特定する。公開前のファネルは「SNS再生 → プロフィール・リンクのクリック → 事前登録ページ → 事前登録」。
   - SNS再生 → ページ訪問（ct別） → インストール → 無料体験開始 → 有料化 → 継続
   - 率が低い・先週より落ちた段階を1つ選び、理由の仮説を書く。
4. 打ち手を3つまで決める。弱い段階に合わせて専門スキルを割り当てる（例: ページの成約率が低い → `screenshot-optimization`、体験→有料が低い → `paywall-optimization`、再生は多いのに訪問が少ない → フックとCTAの見直しを `sns-daily` に反映）。
5. `departments/marketing/reports/<week>.md`（例: `2026-W39.md`）に保存する。

```
# 週次レポート <week>（<start>〜<end>）<アプリ名>

## 数字
| 指標 | 今週 | 先週 | 変化 | 出どころ |
|---|---|---|---|---|

## ファネルと一番弱いところ
## 効いた投稿・型 Top3（ページ訪問・インストール基準）
## 来週の打ち手（最大3つ・担当スキル）
## 未取得のデータと取り方
```

6. 記録する。
   - 来週の重点を `secretary.mjs decision add --title "<week> の重点" --decision "..." --reason "..."` に残す。
   - 打ち手を `todo add` する（会話中は確認してから。定期実行なら最大3件、優先度 normal）。
7. 要点（今週の数字の大きな変化、弱いところ、来週の重点）を短く伝え、保存先を添える。
