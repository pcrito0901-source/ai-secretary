# AI秘書（Claude Code スキル）

Claude Code で `/secretary` と呼ぶと、あなた専用の秘書が窓口になります。TODO・メモ・壁打ち・判断の記録・プロジェクトの予定・朝のまとめを、すべてローカルの Markdown に残します。ブラウザのダッシュボードで一覧もできます。

- **本体（`secretary`）は、仕事の種類を問わず誰でも使えます。** 初回に「どんな仕事か」「目標は何か」を聞かれ、必要になったら部署（リサーチ・PM・経理など）を増やしていきます。
- **追加パック（`departments/` の6つのスキル）は任意です。** アプリやサービスを作って広める人向けで、マーケティング・需要検証・数字の分析を担当します。

[cc-company](https://github.com/Shin-sibainu/cc-company)（MIT）の「秘書が窓口、必要になったら部署を増やす」という考え方を参考に、Claude Code 専用として一から作り直したものです。

## できること（本体）

| 話しかけ方の例 | 秘書がすること |
|---|---|
| 「今日やること教えて」 | 今日のTODOを優先度順に表示。期限切れ・期限間近を先に知らせる |
| 「請求書の発行を金曜までにTODOに入れて」 | 優先度と期限を読み取って追加 |
| 「見積もり終わった」 | 該当のTODOを完了にする |
| 「〇〇はやめておく」 | 完了にせず見送る（理由をメモ欄に残す）。毎日のルーティンで入る TODO は、新しいものに置き換わってたまらない |
| 「案件Aの進み具合は？」「納期を金曜にずらして」 | プロジェクトのマイルストーンの一覧・追加・完了・期限の変更・進捗の記録 |
| 「メモして：競合Xが無料プランを開始」 | 今日のメモに時刻つきで追記 |
| 「料金は月980円に決めた。理由は…」 | 判断ログに記録 |
| 「新サービスの名前で壁打ちしたい」 | 質問しながら整理し、結論と次のアクションをノートに保存 |
| 「おはよう」「朝のまとめ」 | 今日のTODO・期限・プロジェクトの予定・前日の振り返り・未整理メモをまとめて保存（開発のリポジトリをつないでいれば、その動きも） |
| 「ダッシュボード開いて」 | ブラウザで一覧画面を起動 |
| 「リサーチ部署を作って」 | 部署フォルダとルールを作成（依頼が続くと秘書から提案もします） |

未完了のTODOは翌日に自動で繰り越されます。

## 追加パック（任意）

| スキル | 部署 | できること |
|---|---|---|
| `marketing-hq` | マーケティング | 集客の相談の入口。宣伝するアプリ・サービスの前提情報、SNS投稿の実績記録と集計、計測用 App Store リンク（pt/ct）の発行、専門スキルへの振り分け |
| `sns-daily` | マーケティング | 実績のある型と、利用者の悩みの言葉をもとに、毎日の投稿案（フック・構成・キャプション）を作る |
| `growth-report` | マーケティング | SNS → ページ → インストール → 課金の週次レポート。弱い段階と来週の打ち手を決める |
| `review-insights` | リサーチ | App Store の公開レビューで、自分と競合を分析（APIキー不要）。競合アプリの検索も |
| `idea-check` | リサーチ | アイデアの需要検証。机の上の調査 → 5人に話を聞く → 案を見せて申込 → 手作業で試す → 最小の試作品 → 公開、の順に、合格ラインを先に決めて進め、記録する |
| `bucket-check` | 分析 | App Store Connect・RevenueCat・PostHog などの数字を週ごとに記録し、どこで人が離れているかを診断。改善ボードで打ち手と結果を管理 |

追加パックは本体の `secretary` を使って動くので、本体と一緒に入れてください。部署のカード（アイデア・アプリの数字）は、その部署を作ったときだけダッシュボードに出ます。

## インストール

Node.js 18 以上が必要です（ダッシュボードの自動更新は Node.js 20 以上を推奨）。

### 方法A: まとめて入れる（おすすめ）

```bash
npx skills add pcrito0901-source/ai-secretary --full-depth -g -a claude-code
```

入れるスキルを選ぶ画面が出ます。本体だけなら `-s secretary` を付けます。全部入れるなら `-s '*'` を付けます。更新は `npx skills update -g` です。

### 方法B: 自分で直しながら使う

リポジトリを手元に置き、使うフォルダを `~/.claude/skills/<スキル名>` にリンクします。リンクにしておくと、このフォルダを直せばそのまま反映されます。

Windows（PowerShell）:

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\secretary" -Target "<このリポジトリの場所>\secretary"
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\marketing-hq" -Target "<このリポジトリの場所>\departments\marketing-hq"
```

macOS / Linux:

```bash
ln -s "/path/to/ai-secretary/secretary" ~/.claude/skills/secretary
ln -s "/path/to/ai-secretary/departments/marketing-hq" ~/.claude/skills/marketing-hq
```

## 使い方

Claude Code で:

```
/secretary
```

初回は「どんな仕事をしているか」「目標や困りごと」を聞かれます。答えるとデータフォルダができて、すぐに使い始められます。

### 自分用の設定はどこに置くか

このリポジトリには、誰でも使える仕組みだけを入れます。**あなたの事業・アプリ・決まりごとは、すべてデータフォルダの側に置きます。** そのため、同じリポジトリを別の人や別の事業で使っても混ざりません。

| 置くもの | 場所 |
|---|---|
| プロフィール（事業・目標）、部署の一覧、つないだリポジトリ | `config.json` |
| 部署ごとの保存ルール（自分の事情に合わせて書き足す） | `departments/<部署>/RULES.md` |
| 宣伝するアプリ・サービスの前提（ターゲット・競合・料金・使う SNS） | `departments/marketing/apps/<ID>.md` |
| プロジェクトとマイルストーン | `departments/pm/projects/<ID>.md` |
| 定期実行のプロンプト（アプリID や、その事業だけの指示） | Claude デスクトップアプリのスケジュール機能など |

### データの保存場所

既定は `~/ai-secretary/`（Windows なら `C:\Users\<ユーザー名>\ai-secretary\`）。環境変数 `AI_SECRETARY_HOME` で変えられます。

```
ai-secretary/
├── config.json            プロフィール・部署一覧・つないだリポジトリ
├── todos/2026-09-23.md    日ごとのTODO
├── inbox/2026-09-23.md    日ごとのメモ
├── notes/                 壁打ち・調べもの
├── decisions/2026-09.md   月ごとの判断ログ
├── briefs/2026-09-23.md   朝のまとめ
└── departments/<部署>/    部署ごとの記録と RULES.md
```

すべて普通の Markdown なので、エディタや Obsidian で開いても読めます。

### 毎朝のルーティン（定期実行）

Claude デスクトップアプリのスケジュール機能などに、**手順書を読む一文だけ**を登録します。手順を直すときは手順書を直せば、履歴が残り、どの環境でも同じ動きになります。

| ルーティン | 手順書 | 定期実行のプロンプトの例 |
|---|---|---|
| 朝のまとめ（例 8:00） | `secretary/references/routines/morning-brief.md` | 「AI秘書の朝のまとめを作る。~/.claude/skills/secretary/references/routines/morning-brief.md を読み、そのとおりに実行する。」 |
| SNS の投稿案（例 7:30・追加パック） | `departments/sns-daily/references/scheduled-run.md` | 「SNSの投稿案を作る。~/.claude/skills/sns-daily/references/scheduled-run.md を読み、アプリID myapp でそのとおりに実行する。」 |

朝のまとめは、今日のおすすめの順番・期限・（あれば）開発の動きと投稿案を、くわしく説明します。通知の機能が使える環境では、要点をスマホに届けます。

### 開発のリポジトリとつなぐ

```bash
node secretary/scripts/secretary.mjs pm link <プロジェクトID> --repo <フォルダ>
```

つなぐと、朝のまとめと `dev` コマンドに直近のコミットが載ります。件名に「ユーザーへ」「…待ち」がある変更は、「確認待ちかもしれません」として知らせます（git は読むだけ）。

### ダッシュボード

Claude Code で「ダッシュボード開いて」と言うか、直接起動します。

```bash
node secretary/scripts/dashboard.mjs
```

`http://127.0.0.1:3940/` が開きます。次のものが並び、ファイルが変わると自動で更新されます。

- TODO（チェックできる）、期限とマイルストーン、7日間の完了数
- メモ、判断、部署、最近のファイル、全文検索
- 部署があれば: アイデア、アプリの数字

自分の PC からしかアクセスできず、外部のサイトからは読み取れない作りになっています。

### コマンドを直接使う

```bash
node secretary/scripts/secretary.mjs --help
node secretary/scripts/secretary.mjs todo add "見積もり送付" --priority high --due tomorrow
node secretary/scripts/secretary.mjs todo drop 見積もり --reason "先方の都合で中止"
node secretary/scripts/secretary.mjs brief --save
node secretary/scripts/secretary.mjs pm list
node secretary/scripts/secretary.mjs pm add myapp "審査に出す" --due 2026-10-05 --section "公開まで"
node secretary/scripts/secretary.mjs pm done myapp 審査
```

## 相性のよい外部スキル（任意）

追加パックは、次のようなスキルと組み合わせると、専門的な作業まで任せられます（`npx skills add` で入れる。入れる前に中身を確かめてください）。

- マーケティング全般: [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
  - social、launch、copywriting、customer-research など
- App Store の最適化・収益化: [appeeky/aso-skills](https://github.com/appeeky/aso-skills)
  - metadata-optimization、screenshot-optimization、retention-optimization など
- App Store Connect の操作: [rorkai/app-store-connect-cli-skills](https://github.com/rorkai/app-store-connect-cli-skills)
  - `asc` CLI が必要。一部は macOS 専用
- 日本語の文章の自然さ: [coji/natural-japanese](https://github.com/coji/natural-japanese)

## 開発

外部パッケージは使っていません。テスト:

```bash
node --test tests/secretary.test.mjs tests/departments.test.mjs
```

追加パックのスクリプトは、リポジトリのまま（`departments/<スキル>/scripts`）でも、スキルフォルダに並べて入れた形（`~/.claude/skills/<スキル>/scripts`）でも、本体の `secretary/scripts` を見つけて動きます（環境変数 `AI_SECRETARY_SCRIPTS` で場所を指定することもできます）。
