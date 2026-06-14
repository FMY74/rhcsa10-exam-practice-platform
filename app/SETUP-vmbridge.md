# SSH ブリッジ セットアップ手順（VM 実物採点）

このアプリは、実機の RHEL 10 VM に SSH 接続して「課題が正しくできているか」を
自動採点できます。そのための中継プログラム `vmbridge.py` をセットアップします。

```
ブラウザ(Mac, :8765) ──HTTP──▶ vmbridge.py(Mac, :8770) ──SSH──▶ RHEL 10 VM
```

ブリッジを起動しなくてもアプリ自体（閲覧・自己採点）は動きます。SSH ブリッジは
「VMで採点」ボタンを使いたいときだけ必要です。

---

## 前提

- VMware Fusion 等に **RHEL 10 の VM** が用意済みで、起動している
- VM 内で **sshd が稼働**している（RHCSA 環境なら通常そのまま動いています）
- VM の IP アドレスが分かる（VM 内で `ip addr` または `hostname -I` で確認）

---

## 手順

### 1. SSH 鍵を作る（Mac 側・初回のみ）

パスワードを設定ファイルに書かずに済むよう、鍵認証を使います。

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rhcsa_vm -N ""
```

### 2. 公開鍵を VM に登録する

```bash
ssh-copy-id -i ~/.ssh/rhcsa_vm.pub root@<VMのIP>
```

`ssh-copy-id` が無い場合は、`~/.ssh/rhcsa_vm.pub` の内容を VM の
`~/.ssh/authorized_keys` に追記してください。

登録できたら、パスワードなしで入れることを確認します:

```bash
ssh -i ~/.ssh/rhcsa_vm root@<VMのIP> hostname
```

### 3. ブリッジの設定ファイルを作る

`app/tools/` で、テンプレートをコピーして編集します:

```bash
cd app/tools
cp vmbridge.config.example.json vmbridge.config.json
```

`vmbridge.config.json` を開き、自分の VM に合わせて書き換えます:

```json
{
  "ssh_host": "192.168.x.x",       ← VM の IP
  "ssh_user": "root",
  "ssh_key": "~/.ssh/rhcsa_vm",
  "ssh_port": 22,
  "bridge_port": 8770
}
```

> `vmbridge.config.json` は `.gitignore` 済みです（秘密情報なのでコミットされません）。

### 4. ブリッジを起動する

```bash
python3 app/tools/vmbridge.py
```

`VM接続` 等の情報と `token` が表示され、待ち受け状態になります。
このターミナルは開いたままにしておきます。

### 5. アプリを開く

別のターミナルでアプリのサーバを起動し（未起動の場合）:

```bash
python3 -m http.server 8765 --directory app
```

ブラウザで **http://localhost:8765/index.html** を開きます。
画面右上のインジケータが **「● VM接続」（緑）** になれば成功です。

---

## 使い方

1. 問題画面を開き、まず **VM で実際に課題を実施**します
2. **「VMで採点」** ボタンを押すと、ブリッジ経由で VM の状態が check 別に採点されます
3. 再起動後の永続性チェックがある問題（例: LVM）は、**VM を再起動してから**
   「VM 再起動後チェックを実行」ボタンを押します

---

## トラブルシュート

| インジケータ | 状態 | 対処 |
|---|---|---|
| ● VM未接続（灰） | `vmbridge.py` が起動していない／到達できない | ブリッジを起動。`bridge_port` が他と衝突していないか確認 |
| ● VM未到達（橙） | ブリッジは起動中だが VM に SSH できない | VM が起動しているか、IP・鍵パス・sshd 稼働を確認。`ssh -i <鍵> <user>@<IP> hostname` が通るか手動確認 |
| ● VM接続（緑） | 正常 | そのまま「VMで採点」が使えます |

- `file://` で開いた場合は自動採点は使えません（ブラウザのセキュリティ制約）。
  必ず `http://localhost:8765` で開いてください。自己採点は `file://` でも動きます。

---

## セキュリティについて

- `vmbridge.py` は **127.0.0.1 のみ**で待ち受け、外部公開しません
- ブラウザは **問題 ID のみ**を送信し、実行コマンドはブリッジ側の信頼済み定義
  （`manual_overrides.json` の `grader`）から解決されます。ブラウザから任意の
  コマンドは実行できません
- 採点コマンドは原則 **read-only**（状態を変えない確認コマンド）です
- 起動時のランダム token と Origin 検証で、他サイトからの呼び出しを防ぎます
