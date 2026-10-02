---
name: review-insights
description: AI秘書リサーチ部のApp Storeレビュー分析。自分のアプリと競合アプリの公開レビューを集め、不満・要望・評価されている点を整理して、差別化ポイント・改善TODO・SNSのフック案に変える。キーワードから競合アプリを探すこともできる。「レビュー分析」「競合のレビュー」「ユーザーの不満を調べて」「競合を探して」や週次の定期実行で使う。
---

# レビュー分析（リサーチ部）

App Store の公開データ（APIキー不要）を使う。コマンド:

```
node "$HOME/.claude/skills/review-insights/scripts/reviews.mjs" <search|lookup|fetch> ...
node "$HOME/.claude/skills/marketing-hq/scripts/growth.mjs" app list
node "$HOME/.claude/skills/secretary/scripts/secretary.mjs" <コマンド>
```

**定期実行で動いているときは質問しない。** 足りない情報は報告して終える。

## 手順

1. `secretary.mjs status` を確認する。`research` 部署がなければ、会話中なら作ってよいか聞いて `dept add research`、定期実行なら報告して終える。
2. 対象アプリを決める。
   - `growth.mjs app list` で自分のアプリを確認し、ファイルの「競合と違い」から競合の App Store ID を拾う。
   - 競合が未記入なら `reviews.mjs search <キーワード>` で候補を出す。会話中は候補から選んでもらう（評価件数が多い上位3つが目安）。選ばれた競合は、アプリのファイルの「競合と違い」に追記してよいか聞く。
3. 各アプリについて `reviews.mjs fetch <ID> --pages 2 --save` を実行し、保存された JSON を Read ツールで読む。
   - 不満を深掘りするときは `--max-rating 3 --pages 5` のように絞る。
   - 自分のアプリのレビューは App Store Connect 連携（customer reviews）でも取れる。返信の有無も分かるので、使えるならそちらも見る。
4. 分析する。`customer-research`（声の分類）と `competitor-analysis`（競合比較）の考え方を使う。
   - 不満のテーマを分類し、件数の多い順に並べる（例: 同期が消える／広告が多い／価格が高い）
   - 要望・欲しい機能
   - 評価されている点（ユーザー自身の言葉は、宣伝文やSNSのフックにそのまま使える）
   - バージョンごとの評価の変化（アップデートで下がったなど）
   - 引用は短い要約にし、投稿者名は書かない
5. 次の形式で `departments/research/topics/reviews/YYYY-MM-DD-<対象>.md` に保存する（Write ツール）。

```
# レビュー分析: <対象アプリ> YYYY-MM-DD

- 対象: <アプリ名（ID）>… / 件数・期間 / 平均評価と分布

## 不満トップ5（件数・よくある声の要約）
## 要望
## 評価されている点
## 競合との比較（自分のアプリが勝てる点・負けている点）
## 示唆
### 差別化・改善のアイデア
### SNSのフック案（ユーザーの悩みの言葉をそのまま使う）
## 次のアクション
```

6. 次のアクションを TODO にする。会話中は提案して了承されたものを `todo add`。定期実行なら「レビュー分析を確認: topics/reviews/YYYY-MM-DD-<対象>.md」の1件だけ追加する。
7. 要点（不満トップ3、狙えそうな差別化、使えるフック）を短く伝え、保存先を添える。
