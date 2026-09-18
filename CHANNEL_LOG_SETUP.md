# Discordチャンネル投稿ログ セットアップ手順

指定したDiscordチャンネル直下の投稿を、**1日1回まとめて**専用のGoogleスプレッドシートへ記録する仕組みです。
既存の「活動ログの自動記録」（ニューススレッド内の発言を `User` シートへ記録するもの）とは
**別モジュール・別GAS・別スプレッドシート**です。

## 0. 決めてあること（2026-09-18 本人判断）

| 論点 | 決定 |
|------|------|
| 収集方式 | 定期バッチのみ。リアルタイム監視（messageCreate）はしない |
| 置き場所 | `daily-news-bot` に新モジュールとして追加 |
| 書き込み先 | 新しいGAS＋新しいスプレッドシート（既存GASには触らない） |
| 収集範囲 | チャンネル直下のメッセージのみ。Botの投稿も含める |

スレッド内の発言は対象外です（必要になったら `DISCORD_CHANNEL_LOG_INCLUDE_THREADS` のような
スイッチを足す形になりますが、いまは実装していません）。

## 1. スプレッドシートとGASを用意する

書き込み先は指定済みのこのスプレッドシートです。

- <https://docs.google.com/spreadsheets/d/1PJOMl6V05KgqKJq1o-dH-OiCnsx6Xvj8BXWBxGXskUs/edit?gid=0#gid=0>

1. 上のスプレッドシートを開く
2. **拡張機能 → Apps Script** を開く
3. `Code.gs` の中身をすべて消し、リポジトリの **`ChannelLogCode.gs` を丸ごと貼り付けて保存**
4. エディタ上部の関数選択で `testChannelLog` を選んで **実行** → 権限を承認する
   - `Discord_Channel_Log` シートが自動作成され、ダミー1行が入る
   - **確認できたらダミー行は削除する**
5. **デプロイ → 新しいデプロイ → 種類「ウェブアプリ」**
   - 次のユーザーとして実行：**自分**
   - アクセスできるユーザー：**全員**
6. 発行された **ウェブアプリURL（`/exec` で終わるもの）** を控える

> ⚠ GASを修正したら、そのつど**新しいバージョンとしてデプロイし直す**必要があります。
> 保存しただけでは本番のURLの挙動は変わりません。

## 2. 対象チャンネル（設定済み）

`01_input/Metagri日誌自動化：定期バッチでのDiscord収集用.txt` の8チャンネルを
`.env` の `DISCORD_CHANNEL_LOG_CHANNEL_IDS` に設定済みです。

| チャンネル | ID |
|-----------|-----|
| 総合案内 | 951780348465909823 |
| 📣｜重要なアナウンス. | 1090928211715694643 |
| 自己紹介 | 952198046131818567 |
| 音声日誌 | 1109994925841465467 |
| 毎日クイズ | 1353146559717703732 |
| 雑談 | 952209559802507264 |
| ニュース | 952206763539714088 |
| 🔎｜「なぜ？」探求室 | 1510433458122395709 |

⚠ **「イベント一覧」は対象外です。**
渡されたURL `https://discord.com/events/951780348465909820/1354766593078329386` は
チャンネルではなく **スケジュールイベント** で、メッセージ履歴を持ちません。
イベント情報が要る場合は `guild.scheduledEvents` を使う別の仕組みになります。

⚠ **「ニュース」チャンネルはスレッドが対象外です。**
このチャンネルはBotの投稿にスレッドがぶら下がる作りですが、今回の決定は「チャンネル直下のみ」
なので、記録されるのはBotの投稿本体だけで、スレッド内の議論は入りません
（スレッド内の発言は既存の `type:'discussion'` 機能が別シートへ記録しています）。

チャンネルを増やすときは、Discordで **ユーザー設定 → 詳細設定 → 開発者モード** をONにし、
対象チャンネルを右クリック → **IDをコピー** して `.env` のカンマ区切りへ足します。

## 3. Botに権限を与える

対象チャンネルで、Botのロールに次の2つが必要です。

- **チャンネルを見る**（View Channel）
- **メッセージ履歴を読む**（Read Message History）

どちらかが無いと、そのチャンネルだけ `Missing Access` で失敗します
（他のチャンネルの収集は止まりません）。本文を取得するために
Developer Portal 側の **MESSAGE CONTENT INTENT** も必要ですが、これは既に有効です。

## 4. .env を設定する

`.env` には設定済みです（`DISCORD_CHANNEL_LOG_GAS_URL` だけ空なので、手順1のURLを入れてください）。

```env
DISCORD_CHANNEL_LOG_CHANNEL_IDS=951780348465909823,1090928211715694643,952198046131818567,1109994925841465467,1353146559717703732,952209559802507264,952206763539714088,1510433458122395709
DISCORD_CHANNEL_LOG_GAS_URL=https://script.google.com/macros/s/xxxxx/exec
DISCORD_CHANNEL_LOG_CRON=10 5 * * *
DISCORD_CHANNEL_LOG_INCLUDE_BOTS=true
DISCORD_CHANNEL_LOG_INITIAL_LOOKBACK_DAYS=7
DISCORD_CHANNEL_LOG_MAX_PER_RUN=1000
DISABLE_DISCORD_CHANNEL_LOG=false
```

`DISCORD_CHANNEL_LOG_CHANNEL_IDS` が空のままだと、起動ログに
`- Discord Channel Log: skipped` と出てジョブ自体が登録されません（誤作動しない側に倒しています）。

## 5. 手動で1回試す

```bash
# シートへ書かずに件数と先頭3行だけ見る
node scripts/run-discord-channel-log-once.js --dry-run

# 過去30日ぶんを取り直して確認（カーソルを無視する）
node scripts/run-discord-channel-log-once.js --from-scratch --lookback-days 30 --dry-run

# 実際にシートへ書き込む
node scripts/run-discord-channel-log-once.js
```

重複はGAS側が Message ID で弾くので、**同じ範囲を何度実行しても行は増えません**。
過去ログをまとめて入れたいときは `--from-scratch --lookback-days 90` のように遡って実行します。

## 6. シートの列

| 列 | 中身 |
|----|------|
| Timestamp | JSTの日時（`yyyy/MM/dd HH:mm:ss` 書式の日付値。並べ替え・フィルタ用） |
| Date | ISO8601（UTC）の文字列。機械処理用の正 |
| Message ID | Discordのsnowflake（**テキスト書式で固定**） |
| User ID | 投稿者のID（テキスト書式） |
| User Name | Discordのユーザー名（`noujoujin` のような一意な名前） |
| Display Name | サーバー上の表示名（ニックネーム） |
| Content | 本文。本文が空の投稿は `[attachment] URL` / `[embed] タイトル URL` で補う |
| Channel ID | チャンネルID（テキスト書式） |
| Channel Name | チャンネル名 |

> 🔴 **ID列をテキスト書式にしているのは飾りではありません。**
> snowflakeは19桁の数値文字列なので、書式を当てないとスプレッドシートが数値と解釈して
> `1.40934E+18` のように丸め、**IDが壊れて二度と復元できません**。
> シートを作り直すときも `getLogSheet_()` を通す（手で列を足さない）でください。

## 7. 取りこぼしと重複が起きない理由

取得の起点は**日付ウィンドウではなく「前回記録した最後の Message ID」**です。
snowflakeは時刻の昇順なので、これをカーソルにすると次の2つが同時に成立します。

- 実行が1日飛んでも、その間の投稿は次回にまとめて入る（取りこぼさない）
- 同じ実行を2回走らせても、2回目は0件になる（重複しない）

カーソルの**正はスプレッドシート**です（`getChannelLogCursors` で毎回読み直す）。
ローカルの `state/discord-channel-log.json` はその写しで、GASが落ちている日に
前回位置を見失わないためだけに置いています。

書き込みが途中で失敗したときは**カーソルを進めません**。次の実行で同じ範囲を取り直し、
既に入っている行はGAS側が弾きます。

## 8. うまくいかないときの見どころ

| 症状 | 見るところ |
|------|-----------|
| 起動ログに `skipped` と出る | `DISCORD_CHANNEL_LOG_CHANNEL_IDS` が空 |
| 特定チャンネルだけ `Missing Access` | そのチャンネルでBotに「メッセージ履歴を読む」が無い |
| Content が空ばかり | Developer Portal の MESSAGE CONTENT INTENT |
| IDが `1.4E+18` になっている | シートを手で作った（`getLogSheet_()` を通していない） |
| `カーソル取得に失敗…status code 401` | **デプロイ設定**。デプロイ → 編集（鉛筆）→「次のユーザーとして実行: 自分」「アクセスできるユーザー: 全員」。この2つが揃っていないと、URLが正しくてもログイン画面へ飛ばされる。既存デプロイを編集すればURLは変わらないが、**新しいデプロイを作るとURLが変わる**ので `.env` の差し替えが要る |
| `status code 404` | URLが古いデプロイを指している |
| 毎回同じ行を取りに行く | GAS URLが間違っている／デプロイし直していない（カーソルが読めていない） |
| 1回の実行で1000件で止まる | `DISCORD_CHANNEL_LOG_MAX_PER_RUN`。続きは次の実行で入るので異常ではない |

---

## 8. 日誌素案チャンネルへの週次投稿（2026-09-18 追加）

同じ生ログを、毎週木曜6:00 JSTに「日誌素案」チャンネルへも投稿します。
ローカルへ書き出す `scripts/export-discord-day.js` と**まったく同じ形式**です
（形式の組み立ては `discord-day-digest.js` の1か所だけ。ファイルとDiscordで割れないようにしています）。

```env
DIARY_DRAFT_CHANNEL_ID=1550442184916992000
DIARY_DRAFT_CRON=0 6 * * 4
DIARY_DRAFT_OFFSET_DAYS=1
DISABLE_DIARY_DRAFT=false
```

- 対象は**前日ぶんの1日分**（木曜に走ると水曜ぶん）。`DIARY_DRAFT_OFFSET_DAYS` で変えられます
- 2,000字を超える日は複数メッセージへ自動分割し、2通以上のときだけ `(1/3)` が付きます
- `DIARY_DRAFT_CHANNEL_ID` が空だと起動ログに `- Diary Draft: skipped` と出てジョブは登録されません
- 🔴 Botに、投稿先チャンネルでの**メッセージを送信**権限が必要です

```bash
# 投稿せずに本文だけ確認する
node scripts/run-diary-draft-once.js --dry-run

# 日付を指定して投稿する
node scripts/run-diary-draft-once.js --date 2026-09-17
```
