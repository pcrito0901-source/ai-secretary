# AI秘書（Claude Code スキル）

Claude Code で `/secretary` と呼ぶと、あなた専用の秘書が窓口になります。TODO・メモ・壁打ち・判断の記録・朝のまとめをすべてローカルの Markdown に残し、ブラウザのダッシュボードで一覧できます。

[cc-company](https://github.com/Shin-sibainu/cc-company)（MIT）の「秘書が窓口、必要になったら部署を増やす」という考え方を参考に、Claude Code 専用として一から作り直したものです。

## できること

| 話しかけ方の例 | 秘書がすること |
|---|---|
| 「今日やること教えて」 | 今日のTODOを優先度順に表示。期限切れ・期限間近を先に知らせる |
| 「請求書の発行を金曜までにTODOに入れて」 | 優先度と期限を読み取って追加 |
| 「見積もり終わった」 | 該当のTODOを完了にする |
| 「メモして：競合Xが無料プランを開始」 | 今日のメモに時刻つきで追記 |
| 「料金は月980円に決めた。理由は…」 | 判断ログに記録 |
| 「新サービスの名前で壁打ちしたい」 | 質問しながら整理し、結論と次のアクションをノートに保存 |
| 「おはよう」「朝のまとめ」 | 今日のTODO・期限・前日の振り返り・未整理メモをまとめて保存 |
| 「ダッシュボード開いて」 | ブラウザで一覧画面を起動 |
| 「リサーチ部署を作って」 | 部署フォルダとルールを作成（依頼が続くと秘書から提案もします） |

未完了のTODOは翌日に自動で繰り越されます。

## インストール

このフォルダの `secretary/` を Claude Code の個人スキルとして登録します。

Windows（PowerShell）:

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\secretary" -Target "<このリポジトリの場所>\secretary"
```

macOS / Linux:

```bash
ln -s "/path/to/AI秘書/secretary" ~/.claude/skills/secretary
```

リンクにしておくと、このフォルダを編集すればそのまま反映されます。Node.js 18 以上が必要です（ダッシュボードの自動更新は Node.js 20 以上推奨）。

## 使い方

Claude Code で:

```
/secretary
```

初回は「どんな仕事をしているか」「目標や困りごと」を聞かれます。答えるとデータフォルダができて、すぐに使い始められます。

### データの保存場所

既定は `~/ai-secretary/`（Windows なら `C:\Users\<ユーザー名>\ai-secretary\`）。環境変数 `AI_SECRETARY_HOME` で変えられます。

```
ai-secretary/
├── config.json            プロフィールと部署一覧
├── todos/2026-09-23.md    日ごとのTODO
├── inbox/2026-09-23.md    日ごとのメモ
├── notes/                 壁打ち・調べもの
├── decisions/2026-09.md   月ごとの判断ログ
├── briefs/2026-09-23.md   朝のまとめ
└── departments/<部署>/    部署ごとの記録と RULES.md
```

すべて普通の Markdown なので、エディタや Obsidian で開いても読めます。

### ダッシュボード

Claude Code で「ダッシュボード開いて」と言うか、直接起動します:

```bash
node secretary/scripts/dashboard.mjs
```

`http://127.0.0.1:3940/` が開きます。TODO のチェック、期限、7日間の完了数、メモ、判断、部署、最近のファイル、全文検索に対応し、ファイルが変わると自動で更新されます。自分のPCからしかアクセスできず、外部サイトから読み取られない作りになっています。

### コマンドを直接使う

```bash
node secretary/scripts/secretary.mjs --help
node secretary/scripts/secretary.mjs todo add "見積もり送付" --priority high --due tomorrow
node secretary/scripts/secretary.mjs brief --save
```

## 部署の専用スキル（`departments/`）

| スキル | 部署 | できること |
|---|---|---|
| `marketing-hq` | マーケティング | 集客の相談の入口。アプリの前提情報の登録、SNS投稿の実績記録と集計、計測用 App Store リンク（pt/ct）の発行、専門スキルへの振り分け |
| `sns-daily` | マーケティング | 実績のある型とレビューの悩みをもとに、毎日の投稿案（フック・構成・キャプション）を作って保存 |
| `growth-report` | マーケティング | SNS → ページ → インストール → 課金の週次レポート。弱い段階と来週の打ち手を決める |
| `review-insights` | リサーチ | App Store の公開レビューで自分と競合を分析（APIキー不要）。競合アプリの検索も |
| `idea-check` | リサーチ | アイデアの需要検証。机の上の調査 → 5人に話を聞く → 案を見せて申込 → 手作業で試す → 最小の試作品 → 公開、の順に合格ラインを先に決めて進め、記録する |
| `bucket-check` | 分析 | App Store Connect・RevenueCat・PostHog の数字を週ごとに記録し、バケツの穴を診断。改善ボードで打ち手と結果を管理。ダッシュボードの「アプリの数字」に全アプリを表示 |

インストールは `secretary` と同じく、各フォルダを `~/.claude/skills/<スキル名>` にリンクします。

### 組み合わせて使う外部スキル

`npx skills add` で導入したもの（中身は確認済み）:
- [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills): social, video, content-strategy, marketing-ideas, marketing-plan, launch, copywriting, marketing-psychology, customer-research, product-marketing, ab-testing, analytics
- [appeeky/aso-skills](https://github.com/appeeky/aso-skills): app-marketing-context, aso-audit, keyword-research, metadata-optimization, screenshot-optimization, custom-product-pages, app-preview-video, competitor-analysis, review-management, rating-prompt-strategy, creator-ugc-marketing, web-to-app-funnel, monetization-strategy, paywall-optimization, onboarding-optimization, retention-optimization, subscription-lifecycle, referral-program
- [rorkai/app-store-connect-cli-skills](https://github.com/rorkai/app-store-connect-cli-skills): asc-* 13種（`asc` CLI が必要。Windows で使えない asc-aso-audit・asc-screenshot-resize は 2026-10-01 に外した）
- [expo/skills](https://github.com/expo/skills): expo-native-ui、eas-app-stores（2026-10-01 追加）
- [get-convex/agent-skills](https://github.com/get-convex/agent-skills): convex-deploy-guard、convex-reviewer、convex-advisor（後の2つは 2026-10-01 追加）
- [coji/natural-japanese](https://github.com/coji/natural-japanese): natural-japanese（2026-10-01 追加。`uv` が無い環境では `python scripts/lint.py` で動く）

更新は `npx skills update -g`。

## 開発

外部パッケージは使っていません。テスト:

```bash
node --test tests/secretary.test.mjs tests/departments.test.mjs
```
