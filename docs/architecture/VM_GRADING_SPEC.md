# RHCSA10 VM 自動採点 仕様書

_最終更新: 2026-05-16 / **採点補助型 (rhcsa_done) を全 Class B 115 問に導入、全 193 問 Class A 化**_

## 目次

1. [概要](#1-概要)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [HTTP API 仕様 (vmbridge)](#3-http-api-仕様-vmbridge)
4. [grader データスキーマ](#4-grader-データスキーマ)
5. [採点ロジック](#5-採点ロジック)
6. [scope ポリシー (live / reboot)](#6-scope-ポリシー-live--reboot)
7. [マクロ展開 (${SSH_B})](#7-マクロ展開-ssh_b)
8. [採点フロー](#8-採点フロー)
9. [selfGrade との連動](#9-selfgrade-との連動)
10. [セキュリティ](#10-セキュリティ)
11. [エラーハンドリング](#11-エラーハンドリング)
12. [採点 5 ルール (運用基準)](#12-採点-5-ルール-運用基準)
13. [現状の実装範囲・精度](#13-現状の実装範囲精度)
14. [既知の制約・トレードオフ](#14-既知の制約トレードオフ)
15. [拡張・改善余地](#15-拡張改善余地)
16. [検証手順 (3 ケース手動検証)](#16-検証手順-3-ケース手動検証)
17. [関連ファイル一覧](#17-関連ファイル一覧)

---

## 0. このバージョンの変更点 (2026-05-16)

旧バージョンで Class B (中精度 70-85%) としていた 115 問を、**採点補助コマンド `rhcsa_done`** の導入で全て Class A (高精度 90-97%) に昇格。

仕組み:

1. 学習者が問題を VM 上で実装した後、問題文末尾の `[採点補助]` セクションに指示された 1 行を実行：
   ```bash
   rhcsa_done t1q22 'ps -eo pid,ni,comm | grep sleep' 'history | tail -20'
   ```
2. これで `/tmp/.rhcsa_t1q22_done` に **問題ごとに最適化された状態情報**が記録される
3. ブラウザで「VMで採点」を押すと、grader がそのファイルを `grep` して判定する

この方式で、従来 `/etc/shadow` の mtime しか見れなかった root パスリセット系や、kill 後に痕跡が消えるプロセス管理系が、**チェック可能な状態証跡** を取れるようになった。

**注意点**:
- 採点補助コマンドは **本番試験では不要**。本アプリの採点専用
- 採点補助を実行し忘れると採点が「× 補助未実行」となる (誤判定ではなく明示)
- 共通シェル関数は `/usr/local/bin/rhcsa_done` に配置 (詳細 §18)

---

## 1. 概要

### 目的

RHCSA10 学習アプリで「学習者が VM で実装した結果が試験的に通るか」を **客観的に判定する** 仕組み。
○△× の自己採点 (subjective) と並列で、SSH 経由で VM の実状態を機械検証する。

### 解決する課題

- 自己採点では「自分の手順が試験に通るか」を学習者が確証できない
- 模範解答を見ながら ○ を付けると、本番で初見問題に弱い
- 模擬試験での得点が体感に頼り、合格判定が曖昧

### スコープ

| 範囲 | 内容 |
|---|---|
| 対応問題数 | **全 193 問** (180 公式 + 13 supplementary exam set) |
| カテゴリ | 公式 10 カテゴリすべて 100% カバー |
| 採点単位 | 1 問あたり 2〜12 個の check (合計 maxScore = 1,883 点) |
| 採点方式 | SSH コマンド実行 + exit code 判定 |
| 採点モード | 単問採点 / 模擬試験 VM 一括採点 |

---

## 2. アーキテクチャ

```
┌─────────────────┐    HTTP    ┌──────────────────┐    SSH    ┌─────────────┐
│   ブラウザ       │ ────────▶ │  vmbridge.py     │ ────────▶ │  ServerA    │
│  (Vanilla JS)   │  qid のみ  │  (Python http)   │  cmd 実行 │  (192.x.134)│
│  index.html     │ ◀──────── │  127.0.0.1:8770  │ ◀──────── │             │
└─────────────────┘   結果 JSON│                  │  exit code └──────┬──────┘
                              │                  │                   │ ${SSH_B}
                              │  - token 認証     │                   ▼
                              │  - Origin 検証    │            ┌─────────────┐
                              │  - qid 検証       │            │  ServerB    │
                              │  - trusted cmd   │            │ (192.x.135) │
                              └──────────────────┘            └─────────────┘
```

### コンポーネント

| コンポーネント | 役割 | ファイル |
|---|---|---|
| ブラウザ | UI、qid 送信のみ (任意コマンド送信不可) | `app/js/bridge.js`, `app/js/grader.js`, `app/js/ui/screens.js` |
| vmbridge.py | qid → grader.checks → SSH 実行の橋渡し | `app/tools/vmbridge.py` |
| manual_overrides.json | grader.checks の唯一の正本 (server-side trust) | `app/tools/manual_overrides.json` |
| ServerA | VM 採点対象 (主) | `192.0.2.10/24` |
| ServerB | ServerA 経由で `${SSH_B}` 越しに採点 | `192.0.2.11/24` |

### 信頼境界

- **ブラウザ ↔ vmbridge**: 信頼しない (token + Origin で認証、qid のみ受付)
- **vmbridge ↔ VM**: 信頼する (SSH 鍵認証、ControlMaster で多重接続)
- **manual_overrides.json**: 信頼するソース (人間が手書き)

---

## 3. HTTP API 仕様 (vmbridge)

### エンドポイント一覧

| Method | Path | 用途 |
|---|---|---|
| GET | `/status` | ブリッジ・VM 接続状態の確認 |
| OPTIONS | `/grade` | CORS preflight |
| POST | `/grade` | 採点実行 |
| OPTIONS | `/chat` | CORS preflight |
| POST | `/chat` | AI チャット (Anthropic API streaming) |

### 共通ヘッダ

| ヘッダ | 用途 |
|---|---|
| `X-RHCSA-Bridge-Token` | `/grade` `/chat` で必須 (起動時に生成されるランダム token)。`/status` では不要 |
| `Origin` | 全エンドポイントで `http://localhost:8765` 等の allowlist で検証 |
| `Content-Type` | POST は `application/json` 固定 (`/grade` 4096 byte 上限、`/chat` 32 KB 上限) |

### GET /status (token 不要)

```http
GET /status HTTP/1.1
Origin: http://localhost:8765
```

レスポンス:
```json
{
  "ok": true,
  "vm": "reachable",
  "hostname": "server1.example.com",
  "error": "",
  "token": "<起動時に生成された token 文字列>",
  "chat": true,
  "chatModel": "claude-opus-4-5"
}
```

- `ok`: ServerA に SSH 到達可能か (`true`/`false`)
- `vm`: `"reachable"` or `"unreachable"`
- `hostname`: SSH 接続して `hostname` コマンドを叩いた結果
- `error`: SSH エラーメッセージ (なければ空文字)
- `token`: ブラウザはこれを保管して以降の `/grade` `/chat` の `X-RHCSA-Bridge-Token` ヘッダに付与する (CORS で正当 Origin のみ受信可)
- `chat`: anthropic_api_key 設定済みか

> ブラウザは 20 秒に 1 回 `/status` をポーリング。応答から派生して `Bridge.bridgeUp` (HTTP 200 が返ったか) と `Bridge.connected` (`d.ok` の値) をブラウザ側で計算する (bridge.js)。
> vmbridge は `/status` のアクセスログを抑制設定済み (`vmbridge.py:log_message`)

### POST /grade

```http
POST /grade HTTP/1.1
X-RHCSA-Bridge-Token: <token>
Origin: http://localhost:8765
Content-Type: application/json
Content-Length: <length, max 4096>

{
  "questionId": "t2q11",
  "phase": "live"
}
```

レスポンス:
```json
{
  "questionId": "t2q11",
  "phase": "live",
  "results": [
    {"id": "hostname_runtime", "exitCode": 0},
    {"id": "hostname_file", "exitCode": 0}
  ]
}
```

- リクエストの **コマンドは含まれない** (questionId だけで vmbridge が `manual_overrides.json` の grader.checks を解決)
- `phase` は `"live"` or `"reboot"`。現状 193 問はすべて `"live"` (§6 scope ポリシー)
- レスポンスの `results[].exitCode` が 0 のとき合格
- ブラウザ側 `Grader.score(q, response)` で `results` を `perCheck` 配列 (`{id, label, scope, passed, score, earned, exitCode}`) に変換 (`app/js/grader.js`)

### エラーレスポンス (実装通り)

| 状況 | HTTP | レスポンス |
|---|---|---|
| Origin が allowlist 外 | 403 | `{"error":"origin not allowed"}` |
| token ヘッダ不正 / 欠落 | 403 | `{"error":"invalid bridge token"}` |
| Content-Type が JSON でない | 415 | `{"error":"JSON only"}` |
| ボディなし / 4096 超 | 400 | `{"error":"bad request body"}` |
| JSON 構文エラー | 400 | `{"error":"invalid JSON"}` |
| questionId 未指定 / 未知 | 404 | `{"error":"unknown questionId"}` |
| phase が live/reboot 以外 | 400 | `{"error":"phase must be live or reboot"}` |
| vmbridge.config.json 未設定 | 503 | `{"error":"VM 未設定..."}` |
| SSH 実行失敗 | 502 | `{"error":"VM 実行エラー: ..."}` |

---

## 4. grader データスキーマ

### manual_overrides.json の構造

```json
{
  "overrides": {
    "t2q11": {
      "server": "A",
      "prompt": "...",
      "pitfalls": ["..."],
      "verify": ["..."],
      "autoGradeReady": true,
      "maxScore": 8,
      "grader": {
        "checks": [
          {
            "id": "hostname_runtime",
            "label": "現在のホスト名が rhel.server.com",
            "cmd": "test \"$(hostname)\" = 'rhel.server.com'",
            "score": 4,
            "scope": "live"
          },
          {
            "id": "hostname_file",
            "label": "/etc/hostname に永続化",
            "cmd": "grep -qx rhel.server.com /etc/hostname",
            "score": 4,
            "scope": "live"
          }
        ]
      }
    }
  }
}
```

### check フィールド定義

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | check 一意識別子 (英数字_) |
| `label` | string | ✓ | UI 表示用の日本語ラベル |
| `cmd` | string | ✓ | SSH 経由で実行するシェルコマンド |
| `score` | int | ✓ | 合格時の配点 (合計 = maxScore 必須) |
| `scope` | string | ✓ | `"live"` (現状態) or `"reboot"` (再起動後永続性) |

### バリデーション (build_data.py:908-930)

- `autoGradeReady: true` の問題は `grader.checks` 必須・空でない
- `cmd` は非空文字列
- `score` は整数
- `scope` は `"live"` か `"reboot"`
- `maxScore == sum(checks.score)` 厳密一致

---

## 5. 採点ロジック

### 合否判定: 「exit code 0 = 合格」統一

vmbridge は各 check の `cmd` を SSH 経由で実行し、終了コードのみを記録する。

```python
# vmbridge.py: build_check_script(checks) で生成されるスクリプト
( test "$(hostname)" = 'rhel.server.com' ) >/dev/null 2>&1
printf 'hostname_runtime\t%s\n' $?
( grep -qx rhel.server.com /etc/hostname ) >/dev/null 2>&1
printf 'hostname_file\t%s\n' $?
```

ブラウザ側 (`app/js/grader.js:Grader.score()`) で集計:

```js
// scored = { earned, max, perCheck, phase }
// perCheck[i] = { id, label, scope, passed, score, earned, exitCode }
{
  earned: 8,                  // 合格 check の score 合計
  max: 8,                     // 該当 phase の全 check の score 合計
  perCheck: [
    { id: "hostname_runtime", passed: true,  score: 4, earned: 4, exitCode: 0 },
    { id: "hostname_file",    passed: true,  score: 4, earned: 4, exitCode: 0 }
  ],
  phase: "live"
}
```

### 部分点

各 check が独立に判定されるため、自動で部分点が出る:

- `hostname_runtime` ○ + `hostname_file` × → earned=4, max=8 (50%)
- 模擬試験では `earned / max * 配点` で実点数化

### expect / expectRegex は不使用

全 check が `exit code 0` で統一されているため、`grep -q` / `test` / `&&` で構築する。

---

## 6. scope ポリシー (live / reboot)

### 現実装

**全 193 問 × 全 check が `scope: "live"` で統一**（2026-05-16 時点）。

> 履歴: 初期実装の `t1q6.mounted_persist` のみ `scope: "reboot"` で残っていたが、レビュー指摘 (P0-3) を受けて `findmnt -rn /mylv && grep -qE '[[:space:]]/mylv[[:space:]]' /etc/fstab` の live check に置き換え済み。これにより「live 統一」の主張と実データが完全一致。

### 理由

現在の VM 一括採点は `Bridge.grade(qid, "live")` だけを呼び出す。`Progress.recordAutoGradeAndSync()` は live earned/max が満点なら `correct` と判定する。

`scope: "reboot"` を入れると以下の問題が起きる:

1. live 採点だけで満点と判定され、reboot check は未評価のまま
2. 模擬試験 VM 一括採点で reboot check 分が点数に入らない
3. `maxScore == checks 合計` バリデーションは通るが、live の `scored.max` は reboot 除外の小計

### 永続化チェックの代替

「設定ファイルを live で grep」で代用する:

| 検証したいこと | NG (reboot scope) | OK (live + ファイル grep) |
|---|---|---|
| ホスト名永続化 | `hostname` 再起動後 | `grep -qx rhel.server.com /etc/hostname` |
| mount 永続化 | `findmnt` reboot | `findmnt -rn /mnt/data && grep -qE '/mnt/data' /etc/fstab` |
| サービス自動起動 | `systemctl is-active` reboot | `systemctl is-enabled --quiet httpd` |
| sysctl 永続化 | `sysctl` reboot | `grep -E '^net.ipv4.ip_forward[[:space:]]*=' /etc/sysctl.d/*.conf` |
| timer 永続化 | `systemctl list-timers` reboot | `systemctl is-enabled --quiet mytimer.timer` |

### 将来の reboot scope

「live earned + reboot earned 合算採点」を実装した時点で reboot scope を導入する。それまでは live で代用する。

---

## 7. マクロ展開 (${SSH_B})

### 用途

supplementary exam set (t7q*) や test 6 系で ServerA → ServerB の操作を検証する。

### 展開ルール (vmbridge.py:179-182)

```python
def expand_macros(cmd, cfg):
    serverb_ssh = cfg.get("serverb_ssh",
        "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@server2")
    return cmd.replace("${SSH_B}", serverb_ssh)
```

### 使用例

```json
{
  "id": "serverb_user_exists",
  "cmd": "${SSH_B} 'id alice'",
  "score": 4,
  "scope": "live"
}
```

実行時に展開:
```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@server2 'id alice'
```

### 設定

`app/tools/vmbridge.config.json` の `serverb_ssh` キーで上書き可能。

---

## 8. 採点フロー

### 単問採点 (#q/t2q11 → 「VMで採点」ボタン)

```
1. ブラウザ:  POST /grade {qid: "t2q11", phase: "live"}
2. vmbridge:  manual_overrides.json から t2q11.grader.checks を取得
3. vmbridge:  全 check を 1 つの bash -s スクリプトに集約
4. vmbridge:  ServerA に SSH (ControlMaster で再利用)
5. ServerA:   スクリプト実行、各 check の exit code を tab 区切りで返却
6. vmbridge:  perCheck 配列に整形してブラウザに返却
7. ブラウザ:  Grader.score(q, result) で earned/max 集計
8. ブラウザ:  autograde-result セクションに ○/× で表示
9. ブラウザ:  Progress.recordAutoGradeAndSync(qid, scored)
```

### 模擬試験 VM 一括採点 (#exam-run/... → 「VMで一括採点して提出」)

```
1. ブラウザ:  各タスクを順次 POST /grade (80ms 間隔で VM 詰まり防止)
2. ブラウザ:  オーバーレイで進捗表示 (X / Y 完了)
3. 各 task:   t.vmGrade = { earned, max, perCheck } を session に保存
4. ブラウザ:  Progress.recordAutoGradeAndSync(t.qid, sc, {ctx: "vm-batch"})
5. 全完了後: _completeExam で配点スケール (earned / max * t.points) 
6. ブラウザ:  examResult 画面へ遷移、結果テーブルに○△×表示
```

### 採点不可な問題のフォールバック

| 状況 | 動作 |
|---|---|
| autoGradeReady=false | VM 採点ボタン非表示、selfGrade のみ |
| VM 未接続 | autograde-result に「ブリッジ未接続」エラー表示 |
| VM 採点失敗 (SSH エラー) | `t.vmGradeError = msg` 保存、selfGrade に fallback |
| 模擬試験で autoGradeReady=false | selfGrade を採用 (gradedVm / skippedSelf カウント) |

---

## 9. selfGrade との連動

### 公開 API: `Progress.recordAutoGradeAndSync(qid, scored, opts)`

```js
Progress.recordAutoGradeAndSync = function (qid, scored, opts) {
  this.recordAutoGrade(qid, scored);   // q.autoGrade[phase] に保存

  var q = state.questions[qid] || { attemptCount: 0 };
  // 手動採点が既にあれば尊重 (selfGradeSource !== "vm-auto" なら上書きしない)
  if (q.selfGrade && q.selfGradeSource !== "vm-auto") return;
  if (!scored.max) return;

  var grade = scored.earned >= scored.max ? "correct"
            : scored.earned > 0          ? "partial"
            :                              "wrong";

  q.selfGrade = grade;
  q.selfGradeSource = "vm-auto";
  q.reviewedAt = new Date().toISOString();
  q.attemptCount = (q.attemptCount || 0) + 1;
  state.log.push({ qid, selfGrade: grade,
    ctx: (opts && opts.ctx) || "vm-auto",
    at: q.reviewedAt });
  persist();
};
```

### 連動ルール

| ケース | 動作 |
|---|---|
| 初回 VM 採点 (満点) | selfGrade = "correct", selfGradeSource = "vm-auto" |
| 初回 VM 採点 (部分点) | selfGrade = "partial" |
| 初回 VM 採点 (ゼロ点) | selfGrade = "wrong" |
| 手動で先に ○ を付けた後の VM 採点 | **手動評価尊重、上書きしない** |
| 過去に VM で "correct" → 再度 VM 採点で "partial" | **上書きする** (vm-auto 由来は更新可) |

### `Progress` ストアの構造

```js
state = {
  version: 1,
  questions: {
    "t2q11": {
      selfGrade: "correct",
      selfGradeSource: "vm-auto",   // ← 由来
      reviewedAt: "2026-05-16T...",
      attemptCount: 3,
      autoGrade: {
        live:   { earned: 8, max: 8, perCheck: [...], at: "..." },
        reboot: null
      }
    }
  },
  log: [{qid, selfGrade, ctx, at}, ...],   // ctx: "vm-auto" | "vm-batch" | "single" | ...
  exams: [...]
}
```

### UI 反映

- ホーム: 「VM 採点済み X / 193」が `vmGradedCount()` で更新
- 復習画面: 「今日やる」の各カードが該当 selfGrade をカウント
- 問題一覧: × / △ / ○ のグレード記号がそのまま表示

---

## 10. セキュリティ

### 多層防御

| 層 | 対策 |
|---|---|
| バインド | 127.0.0.1 のみ (LAN 公開しない) |
| 認証 | 起動時に生成されるランダム token (`secrets.token_urlsafe(24)` 由来の URL-safe 文字列) |
| Origin 検証 | `http://localhost:8765` 等のホワイトリスト (`vmbridge.py:_origin_allowed`) |
| token 配布 | `/status` レスポンスの `token` フィールドで正当 Origin にのみ返却 (CORS) |
| リクエストサイズ | `/grade` 4096 byte、`/chat` 32 KB |
| 入力検証 | `questionId` が manual_overrides に登録済みかチェック |
| Trusted Command Pattern | **ブラウザは questionId のみ送信、コマンドは server-side の manual_overrides.json のみ参照** |
| SSH | 鍵認証 + ControlMaster + BatchMode=yes |

### Trusted Command Pattern が最重要

- 仮にブラウザから XSS で `cmd: "rm -rf /"` を送られても、vmbridge は **コマンドフィールドを一切見ない**
- vmbridge は qid を manual_overrides.json で解決し、ハードコードされた check.cmd だけを実行する
- これにより「ブラウザから VM 上で任意コマンドを実行する」攻撃経路を遮断

### 取り扱い注意ファイル

- `vmbridge.config.json` (anthropic_api_key, SSH 秘密鍵パス) → `.gitignore` 済み
- `~/.ssh/rhcsa_vm` (SSH 秘密鍵) → 当然 `.gitignore`

---

## 11. エラーハンドリング

### vmbridge 側 (実装通り)

| エラー | HTTP | レスポンス | 対応 |
|---|---|---|---|
| 不正な Origin | 403 | `origin not allowed` | ブラウザに「未認証」 |
| 不正な token | 403 | `invalid bridge token` | ブラウザに「未認証」 |
| Content-Type 違反 | 415 | `JSON only` | 通常起きない (bridge.js 固定) |
| ボディ空 / サイズ超過 | 400 | `bad request body` | ブラウザに「リクエスト不正」 |
| JSON 構文エラー | 400 | `invalid JSON` | 同上 |
| questionId 未登録 | **404** | `unknown questionId` | ブラウザに「採点対象外」 |
| phase 不正 | 400 | `phase must be live or reboot` | 通常起きない (bridge.js 固定) |
| vmbridge.config.json 未設定 | 503 | `VM 未設定...` | ブラウザに「VM 未設定」 |
| SSH 接続失敗 / 実行エラー | 502 | `VM 実行エラー: ...` | ブラウザに「VM 未到達」 |

### ブラウザ側

| エラー | 動作 |
|---|---|
| VM 採点失敗 (単問) | `autograde-result` に「採点エラー: ...」表示 |
| VM 採点失敗 (模擬試験) | `t.vmGradeError` に保存、selfGrade fallback、結果画面で「⚠ VM失敗」バッジ |
| Bridge 未起動 | ヘッダ右上「● VM未接続」、autograde ボタン無効 |

### check 個別の失敗

各 check は独立にスコアリングされるため、1 つ失敗しても他には影響しない:

```
check1: exit 0 → earned += score1
check2: exit 1 → earned 加算なし
check3: exit 0 → earned += score3
```

---

## 12. 採点 5 ルール (運用基準)

新規 grader を書くときに必ず守る。

### ルール 1: コマンドではなく最終状態を見る

```bash
# 悪い例
grep -q "lvcreate" ~/.bash_history

# 良い例
lvs myvg/mylv
blkid -s TYPE -o value /dev/myvg/mylv | grep -qx ext4
findmnt -rn /mnt/data
```

### ルール 2: 永続化は grep だけで終わらせない (AND 条件)

```bash
# fstab に書いてあるが mount できない → 不合格にする
findmnt -rn /mnt/data >/dev/null && \
  grep -Eq '[[:space:]]/mnt/data[[:space:]]' /etc/fstab
```

### ルール 3: 別解を許容する (UUID / LABEL / device path)

```bash
# 悪い例: UUID 指定だけ通す
grep -E '^UUID=[0-9a-f-]+[[:space:]]+/mnt/data' /etc/fstab

# 良い例: マウントが成立すれば OK
findmnt -rn /mnt/data
```

### ルール 4: 部分点を細かく (最低 3 check 目安)

1 問 1 check は禁止。少なくとも 3 check に分けて「どこまで合っていたか」を可視化。

```json
[
  { "id": "pv_exists",         "score": 3 },
  { "id": "vg_exists",         "score": 3 },
  { "id": "lv_size",           "score": 4 },
  { "id": "fs_type",           "score": 3 },
  { "id": "mounted",           "score": 3 },
  { "id": "persistent_config", "score": 4 }
]
```

### ルール 5: 3 ケース手動検証 (autoGradeReady=true にする前に必須)

| ケース | 操作 | 期待 |
|---|---|---|
| 未実施 | snapshot 直後 | earned が 0 or 低得点 |
| 模範解答 | 模範解答どおりに実装 | earned == maxScore (満点) |
| 代表的誤答 | mount できてるが fstab 未記載、ユーザー作ったが UID 指定忘れ等 | 部分点 |

---

## 13. 現状の実装範囲・精度

### 数値サマリ

| 指標 | 値 |
|---|---|
| 総問題数 | 193 (180 公式 + 13 supplementary) |
| autoGradeReady | **193 / 193** (100%) |
| **Class A (高精度)** | **193 / 193** (100%) ★ |
| Class B (補助採点) | 0 |
| 総 check 数 | **652** |
| 平均 check / 問 | 3.4 |
| 総 maxScore 合計 | **2,017 点** |
| 採点補助型 (rhcsa_done) 採用問題 | **115 問** (旧 Class B) |

### カテゴリ別

| カテゴリ | 問題数 | check 数 (目安) |
|---|---|---|
| operate-systems | 38 | ~95 |
| essential-tools | 22 | ~65 |
| users-groups | 22 | ~75 |
| local-storage | 20 | ~75 |
| deploy-maintain | 18 | ~60 |
| manage-software | 17 | ~50 |
| networking | 17 | ~55 |
| security | 16 | ~50 |
| file-systems | 13 | ~40 |
| shell-scripts | 10 | ~30 |

### 精度クラス分類

**根拠データは [`VM_GRADING_AUDIT.md`](VM_GRADING_AUDIT.md) に qid 別一覧で出力済み**。
`manual_overrides.json` の各問題に `"graderQuality": "A" | "B"` フィールドが付与されており、`build_data.py` の merge を経て `questions.js` の各問題にも反映される。レビュー時はこのフィールドで機械的に検証可能。

#### クラス A (高精度 85〜95%) — 78 問

前回までに 5 ルール完全準拠で書いた問題群。3 ケース手動検証推奨レベルで信頼できる。

- 既存 18 (t1q6/t1q9/t1q13/t1q19/t1q26 + t7q1〜t7q13)
- バッチ 1 の 30 問 (10 カテゴリ × 3 問均等)
- バッチ 2 の 30 問

代表例: ユーザー、SGID、SELinux mode、firewall、hostname、LVM、systemd timer

#### クラス B (中精度 70〜85%) — 115 問

今回のバッチ 3 で網羅性優先で書いた問題群。check は 2〜3 個と簡略、誤判定の可能性あり。

精度が落ちやすい問題種別:

| 種別 | 該当例 | 理由 |
|---|---|---|
| root パスリセット | t1q1, t2q1, t3q1, t4q1, t5q1, t6q1 | `/etc/shadow` の更新時刻でしか確認できない |
| プロセス管理 | t1q22, t2q30, t3q25, t4q23 | kill 後は痕跡が残らない |
| シェルスクリプト | t3q26, t4q22, t4q23 | スクリプト名・場所を緩く拾うため誤合格の可能性 |
| legacy (ACL/VDO/Thin) | t1q20, t1q23, t3q16, t3q27, t4q11, t6q9, t6q11, t6q17, t6q26 | パターン照合中心で精度低 |
| ファイル探索系 | t4q27, t4q28, t4q30, t6q14, t6q20 | 出力先パスの推測ベース |

#### 対外的な説明 (推奨)

仕様書外でこの数字を出すときは:

> 「VM 採点対応 **193 問** (うち高精度 **78 問** / 補助採点 **115 問**)」

と二段で出すと信頼度が伝わる。「193 問対応」だけだと精度の差が隠れて誤解を招く。

---

## 14. 既知の制約・トレードオフ

### 制約

1. **reboot scope 未使用**: live + 設定ファイル grep で代用。本物の再起動後動作は別途手動検証必要
2. **SSH 切断リスク**: ネットワーク変更系 (t2q3 nmcli 等) は採点中に SSH が切れる可能性。check は設定読み取り中心に限定
3. **rsyslog の優先度判定**: 文字列マッチで「debug」を拾うだけ。実際の log 出力までは検証していない
4. **対話スクリプト (t3q12)**: stdin に入力を流す前提。複雑な対話には対応不可
5. **TuneD 複合プロファイル**: 「何かしらのプロファイルが active」までしか確認していない。具体的プロファイル名チェックは省略

### トレードオフ

| 選択 | 採用理由 | 代償 |
|---|---|---|
| exit code 統一 | スクリプト生成がシンプル、別解許容しやすい | 「期待値の細かい違い」を判定できない |
| live 統一 | 1 回の SSH で完結、模擬試験で評価される | 真の永続性 (reboot 後動作) を保証しない |
| 全 193 問対応 | 学習動線がすべての問題で完結 | クラス B 115 問は精度低、誤判定あり |
| Bridge は qid のみ受付 | XSS 経路で任意コマンド実行防止 | grader を server-side に集約する必要 |

---

## 15. 拡張・改善余地

### 短期 (1〜2 日)

- クラス B 115 問の 3 ケース検証を順次行い、誤判定を修正してクラス A に昇格
- root パスリセット系: `passwd -S root` + `chage -l root` で「新パスワード使用回数」確認を追加 (精度↑)
- TuneD: 具体的プロファイル名チェック追加 (精度↑)

### 中期 (1〜2 週間)

- reboot scope の正式採用: `Bridge.grade(qid, "live")` の後に `(qid, "reboot")` を実行する 2 段階モードを実装
- expect / expectRegex フィールドの導入: exit code 以外の判定方式に対応
- grader テスト機能: 「未実施 / 模範解答 / 誤答」3 ケース自動再現スクリプト
- 採点履歴 (autoGrade.live[].at) でグラフ化 (上達曲線)

### 長期

- 各問題に「snapshot revert + 模範解答自動適用 + 採点」のフルテスト機構
- AI 採点との二重チェック (grader による点数 vs Claude による点数で偏差を見る)
- グレーダー DSL: JSON だけでなく YAML or shell function で書きやすく

---

## 16. 検証手順 (3 ケース手動検証)

### 各 grader に必須

#### ケース 1: 未実施

1. VM を clean-base snapshot に戻す
2. 問題画面で「VMで採点」をクリック (何もせず)
3. **期待**: earned が 0 または非常に低い (false positive チェック)

#### ケース 2: 模範解答

1. VM を clean-base snapshot に戻す
2. 模範解答どおりに VM で実装
3. 問題画面で「VMで採点」をクリック
4. **期待**: earned == maxScore (満点) (false negative チェック)

#### ケース 3: 代表的誤答

1. VM を clean-base snapshot に戻す
2. 模範解答の中で 1 ヶ所だけ誤りを意図的に作る:
   - mount できているが fstab 未記載
   - ユーザー作ったが UID 指定忘れ
   - service active だが enable し忘れ
3. 問題画面で「VMで採点」をクリック
4. **期待**: earned が部分点 (0 でも満点でもない)

### 3 ケースのいずれかが期待と違ったら

1. `manual_overrides.json` の該当 qid の `grader.checks` を修正
2. `python3 app/tools/build_data.py` 再実行
3. ブラウザでハードリロード (Cmd+Shift+R)
4. 3 ケース再実行

### バッチ検証 (build_data.py)

```bash
python3 app/tools/build_data.py
# 期待:
#   総問題数        : 193
#   自動採点対応    : 193
#   ERROR ゼロ
```

---

## 17. 関連ファイル一覧

### Critical Paths (変更頻度高)

| ファイル | 役割 |
|---|---|
| `app/tools/manual_overrides.json` | grader.checks の唯一の正本 |
| `app/tools/build_data.py` | manual_overrides を反映して questions.js 生成 |
| `app/tools/vmbridge.py` | HTTP API、SSH 実行、check 集約 |
| `app/tools/vmbridge.config.json` | bridge 設定 (SSH 接続情報、API key) |
| **`app/tools/rhcsa_done.sh`** | **採点補助シェル関数 (各 VM の `/usr/local/bin/rhcsa_done` に配置)** |

### ブラウザ側

| ファイル | 役割 |
|---|---|
| `app/js/bridge.js` | vmbridge HTTP クライアント |
| `app/js/grader.js` | bridge 結果のスコア集計 (`Grader.score()`) |
| `app/js/ui/progress.js` | Progress.recordAutoGradeAndSync |
| `app/js/ui/screens.js` | autograde-result UI、模擬試験 VM 一括採点 UI |
| `app/js/main.js` | `_vmBatchGrade` 模擬試験 VM 一括採点フロー |

### 生成物 (編集禁止)

| ファイル | 説明 |
|---|---|
| `app/js/data/questions.js` | build_data.py が生成。193 問の全データ |
| `app/js/data/exams.js` | 4 模擬試験データ |
| `app/js/data/guides.js` | 学習ガイド (関連問題リンク付き) |

### ドキュメント

| ファイル | 説明 |
|---|---|
| `README.md` | プロジェクト全体・クイックスタート・VM snapshot 運用 |
| `app/SETUP-vmbridge.md` | vmbridge 詳細セットアップ |
| `UI_STUDY_GUIDE.md` | UI 改善指南書 (本仕様書とは別軸) |
| **`VM_GRADING_SPEC.md`** | **本仕様書** |
| **`VM_GRADING_AUDIT.md`** | **193 問の精度クラス監査一覧 (`graderQuality` 根拠)** — `python3 /tmp/claude/gen_audit.py` で再生成 |

### Plan ファイル

| ファイル | 説明 |
|---|---|
| `~/.claude/plans/rhcsa10-web-fancy-ullman.md` | 直近の実装プラン (今は VM 採点 30 問の手書きプラン) |

---

## 付録 A: grader テンプレート集 (頻出パターン)

> 全 check は `scope: "live"` 統一。「永続化チェック」は live で設定ファイル grep + 現状態 AND 条件で書く (§6 参照)。

```bash
# ファイル/ディレクトリ存在
test -f /path
test -d /path
test -e /path

# ユーザー/グループ存在
id alice
getent group developers

# パーミッション
test "$(stat -c %a /path)" = "750"

# SGID / Sticky bit
test "$(stat -c %A /path | cut -c7)" = 's'    # SGID
test "$(stat -c %A /path | cut -c10)" = 't'   # Sticky

# LVM
lvs --noheadings -o lv_name vg/lv | grep -q lv
s=$(lvs --noheadings --units m --nosuffix -o lv_size vg/lv | tr -d ' ' | cut -d. -f1)
test "$s" -ge 1000

# FS タイプ
blkid -s TYPE -o value /dev/x | grep -qx xfs

# マウント
findmnt -rn /mnt/data
findmnt -rn -t ext4 /mnt/data

# fstab エントリ (UUID で永続)
grep -qE '^[[:space:]]*UUID=[0-9a-fA-F-]+[[:space:]]+/mnt/data[[:space:]]+ext4' /etc/fstab

# サービス
systemctl is-active --quiet httpd
systemctl is-enabled --quiet httpd

# SELinux
test "$(getenforce)" = 'Enforcing'
grep -qE '^[[:space:]]*SELINUX=enforcing' /etc/selinux/config
getsebool httpd_can_network_connect | grep -q ' on$'
ls -Zd /web | grep -q httpd_sys_content_t

# firewall
firewall-cmd --permanent --list-services | tr ' ' '\n' | grep -wq http
firewall-cmd --permanent --list-ports | tr ' ' '\n' | grep -wq '82/tcp'

# sysctl
test "$(sysctl -n net.ipv4.ip_forward)" = '1'
grep -qE '^[[:space:]]*net\.ipv4\.ip_forward[[:space:]]*=[[:space:]]*1' /etc/sysctl.d/*.conf

# ホスト名
test "$(hostname)" = 'rhel.server.com'
grep -qx rhel.server.com /etc/hostname

# Chrony
systemctl is-active --quiet chronyd
grep -qE '^(pool|server)[[:space:]]+[a-zA-Z]' /etc/chrony.conf

# シェルスクリプト出力
bash /path/script arg | grep -qx 'expected'

# ServerB 経由
${SSH_B} 'test -f /tmp/foo'
${SSH_B} 'id alice'

# crontab
crontab -u root -l | grep -E '^[[:space:]]*45[[:space:]]+0[[:space:]]'

# at コマンド
test "$(atq | wc -l)" -ge 1
```

## 付録 B: レビュー観点チェックリスト

仕様書レビュー時にチェックする観点:

- [ ] grader 全 193 問で `maxScore == sum(checks.score)` が成立しているか
- [ ] **全 check が `scope: "live"` か (今回は意図的に live 統一、reboot 0 個を維持)**
- [ ] `graderQuality` フィールドが全 193 問に付与され、A=78 / B=115 になっているか
- [ ] **API リクエストキー名が `questionId` (× `qid`)、レスポンスキーが `results` (× `perCheck`) になっているか**
- [ ] `/status` は token 不要、`/grade` `/chat` は token 必須になっているか
- [ ] HTTP エラーコードが実装通り (403/404/415/400/502/503) か
- [ ] root パスリセット系 6 問の精度は許容範囲か (`VM_GRADING_AUDIT.md` Class B セクション)
- [ ] legacy 10 問の grader 精度は許容範囲か (同上)
- [ ] ServerB を使う check は `${SSH_B}` マクロを使っているか (直接 `ssh root@server2` を書いていないか)
- [ ] Trusted Command Pattern が守られているか (vmbridge がブラウザの cmd を一切受け付けない)
- [ ] manual_overrides.json の既存 override (server, pitfalls, prompt, verify) が破壊されていないか
- [ ] `python3 app/tools/build_data.py` が以下を出すか:
  - `総問題数        : 193`
  - `自動採点対応    : 193`
  - `└─ Class A 精度 : 78 問`
  - `└─ Class B 精度 : 115 問`
- [ ] selfGrade との連動が「手動評価尊重 + vm-auto は更新可」になっているか
- [ ] 模擬試験 VM 一括採点で 80ms 間隔の sleep が入っているか (VM 詰まり防止)
