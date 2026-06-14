#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vmbridge.py — RHCSA10 exam practice / SSH ブリッジ（自動採点の中継プログラム）

ブラウザ(http://localhost:8765) からの HTTP リクエストを受け、SSH 経由で
実機 RHEL 10 VM に「検証コマンド」を実行し、その結果を返す。

設計（MVP 設計書 §6 準拠）:
  - ブラウザは questionId のみ送信。実行コマンドはこのスクリプトが
    manual_overrides.json の「信頼済み grader 定義」から解決する
    （ブラウザから任意コマンドは受け取らない）。
  - 127.0.0.1 のみ bind。起動時にランダム token を発行。
  - CORS は allowed_origins のみ許可。POST は JSON のみ。Origin を検証。
  - SSH は ControlMaster で多重化（初回接続のみコスト、以降は再利用）。
  - grader.checks は原則 read-only。状態変更系は将来の /reset・/reboot のみ。

使い方:
  1. vmbridge.config.example.json を vmbridge.config.json にコピーして編集
  2. python3 app/tools/vmbridge.py
  3. http://localhost:8765/index.html を開く

Python3 標準ライブラリのみ。
"""

import json
import os
import secrets
import shlex
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(TOOLS_DIR)
CONFIG_PATH = os.path.join(TOOLS_DIR, "vmbridge.config.json")
OVERRIDES_PATH = os.path.join(TOOLS_DIR, "manual_overrides.json")
CONTROL_PATH = os.path.join(tempfile.gettempdir(), "rhcsa_vmbridge_ssh.sock")

DEFAULT_ORIGINS = ["http://localhost:8765", "http://127.0.0.1:8765"]

# 起動時に1度だけ発行するトークン（/grade の認証に使用）
TOKEN = secrets.token_urlsafe(24)


# ---------------------------------------------------------------------------
# 設定・grader 定義の読み込み
# ---------------------------------------------------------------------------
def load_config():
    """vmbridge.config.json を読む。無ければ None（/status が ok:false を返す）。"""
    if not os.path.exists(CONFIG_PATH):
        return None, "vmbridge.config.json が無い（vmbridge.config.example.json をコピーして編集してください）"
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
    except json.JSONDecodeError as e:
        return None, "vmbridge.config.json の JSON が不正: %s" % e
    for key in ("ssh_host", "ssh_user", "ssh_key"):
        if not cfg.get(key):
            return None, "vmbridge.config.json に %s がない" % key
    cfg.setdefault("ssh_port", 22)
    cfg.setdefault("bridge_port", 8770)
    cfg.setdefault("allowed_origins", DEFAULT_ORIGINS)
    # ServerA 上で実行する「ServerB への ssh コマンド」のマクロ。
    # grader.checks[].cmd 中の ${SSH_B} がこれに展開される。supplementary exam set
    # のような複数 VM 試験で、ServerA 経由で ServerB を判定するときに使う。
    cfg.setdefault(
        "serverb_ssh",
        # ServerA 内で実行される ServerB への SSH。ControlMaster で多重化することで、
        # 同一スクリプト内の連続呼び出し（複数 check）を 1 つの接続に集約する。
        "ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=5"
        " -o ControlMaster=auto -o ControlPath=/tmp/rhcsa_ssh_b_%C.sock"
        " -o ControlPersist=60 root@192.0.2.11",
    )
    # AI 質問チャット（任意）。anthropic_api_key が設定されていれば /chat が有効。
    cfg.setdefault("anthropic_api_key", "")
    cfg.setdefault("anthropic_model", "claude-haiku-4-5")
    cfg["ssh_key"] = os.path.expanduser(cfg["ssh_key"])
    return cfg, None


# ---------------------------------------------------------------------------
# 例外
# ---------------------------------------------------------------------------
class GradeError(Exception):
    """run_grade が「checks 配列」を返せなかった場合に送出する。
    do_POST 側で 502 として返却する。"""


def load_graders():
    """manual_overrides.json から「信頼済み grader 定義」を
    { qid: { checks: [...], helperCmds: [...] } } で返す。
    helperCmds は採点時に自動で `rhcsa_done <qid> '<cmd1>' ...` として VM 上で先に流す。
    これによりユーザーが手で rhcsa_done を打たなくても /tmp/.rhcsa_<qid>_done が生成される。"""
    graders = {}
    try:
        with open(OVERRIDES_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print("[WARN] manual_overrides.json を読めない: %s" % e, file=sys.stderr)
        return graders
    for qid, ov in (data.get("overrides") or {}).items():
        g = ov.get("grader")
        if g and isinstance(g.get("checks"), list):
            graders[qid] = {
                "checks": g["checks"],
                "helperCmds": ov.get("helperCmds") or [],
            }
    return graders


def load_question_contexts():
    """questions.js を読んで { qid: {title, prompt, lab, solutionText, pitfalls} } を返す。
    AI チャットの問題コンテキスト注入に使う（信頼済みデータ）。"""
    contexts = {}
    qpath = os.path.join(APP_DIR, "js", "data", "questions.js")
    if not os.path.exists(qpath):
        return contexts
    try:
        import re
        text = open(qpath, encoding="utf-8").read()
        m = re.search(r"const QUESTIONS = (\[.*?\]);\s*\nif", text, re.DOTALL)
        if not m:
            return contexts
        qs = json.loads(m.group(1))
        for q in qs:
            contexts[q["id"]] = {
                "title": q.get("title", ""),
                "prompt": q.get("prompt", ""),
                "lab": q.get("lab", []),
                "solutionText": q.get("solutionText", ""),
                "pitfalls": q.get("pitfalls", []),
                "category": q.get("categoryLabel", ""),
                "test": q.get("test"),
                "qno": q.get("qno"),
            }
    except (OSError, json.JSONDecodeError, ValueError) as e:
        print("[WARN] questions.js を読めない: %s" % e, file=sys.stderr)
    return contexts


# ---------------------------------------------------------------------------
# SSH 実行（ControlMaster で多重化）
# ---------------------------------------------------------------------------
def ssh_base(cfg):
    return [
        "ssh",
        "-o", "BatchMode=yes",                       # パスワードプロンプトを出さない（鍵認証のみ）
        "-o", "ConnectTimeout=5",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ControlMaster=auto",                  # 接続を多重化
        "-o", "ControlPath=" + CONTROL_PATH,
        "-o", "ControlPersist=60",                   # 60秒は接続を保持して再利用
        "-i", cfg["ssh_key"],
        "-p", str(cfg["ssh_port"]),
        "%s@%s" % (cfg["ssh_user"], cfg["ssh_host"]),
    ]


def ssh_run(cfg, remote_args, stdin_data=None, timeout=90):
    """SSH でリモートコマンドを実行。(exit_code, stdout, stderr) を返す。
    timeout の既定は 90 秒。ServerA→ServerB の二段 SSH を多数行う grader
    （supplementary exam set t7q6-12 など）でも余裕で完走するため余裕を持たせる。"""
    try:
        proc = subprocess.run(
            ssh_base(cfg) + remote_args,
            input=stdin_data, capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "SSH timeout"
    except FileNotFoundError:
        return 127, "", "ssh コマンドが見つからない"
    except Exception as e:                            # noqa: BLE001
        return 1, "", "SSH 実行エラー: %s" % e


def vm_status(cfg):
    """VM 到達確認。{ ok, hostname, error } を返す。"""
    if cfg is None:
        return {"ok": False, "error": "config 未設定"}
    rc, out, err = ssh_run(cfg, ["hostname"], timeout=8)
    if rc == 0:
        return {"ok": True, "hostname": out.strip()}
    return {"ok": False, "error": (err.strip() or ("ssh exit %d" % rc))}


def expand_macros(cmd, cfg):
    """grader.checks[].cmd 中の ${SSH_B} 等を config の値に展開する。
    展開対象は信頼済み grader 定義の固定マクロのみ（任意置換はしない）。"""
    return cmd.replace("${SSH_B}", cfg.get("serverb_ssh", ""))


def build_check_script(checks, cfg, qid=None, helper_cmds=None):
    """信頼済み checks から、1回の SSH でバッチ実行するシェルスクリプトを生成。
    各 check は終了コード 0 = 合格。出力は 'id<TAB>exitcode' の行。

    helper_cmds が指定されていれば、先頭で `rhcsa_done <qid> '<cmd1>' ...` を実行して
    /tmp/.rhcsa_<qid>_done を自動生成する（ユーザーが手で打たなくても採点できるように）。
    """
    lines = ["#!/bin/bash"]
    # ヘルパー自動実行（grader.checks の前に /tmp/.rhcsa_<qid>_done を作る）
    if qid and helper_cmds:
        helper_parts = ["rhcsa_done", shlex.quote(qid)]
        for hc in helper_cmds:
            helper_parts.append(shlex.quote(hc))
        # 失敗しても続行（helper 失敗時は helper_fresh check が落ちて原因が分かる）
        lines.append("# auto-run helper for " + qid)
        # </dev/null 必須: スクリプトは bash -s の stdin で流れてくるため、
        # 中の ssh（${SSH_B} 等）が stdin を読むと残りの check 行を食って消す
        lines.append(" ".join(helper_parts) + " </dev/null >/dev/null 2>&1 || true")
    for c in checks:
        cid = str(c.get("id", ""))
        cmd = expand_macros(c.get("cmd", ""), cfg)
        # cid は信頼済みデータだが、念のためシェルクオート。cmd は信頼済み定義をそのまま実行。
        lines.append(
            "( " + cmd + " ) </dev/null >/dev/null 2>&1; "
            + "printf '%s\\t%s\\n' " + shlex.quote(cid) + ' "$?"')
    return "\n".join(lines) + "\n"


def run_grade(cfg, checks, qid=None, helper_cmds=None):
    """checks（phase で絞り済み）を VM 上でバッチ実行し、結果リストを返す。
    qid と helper_cmds を渡すと、checks 実行前に `rhcsa_done <qid> ...` を先に流して
    /tmp/.rhcsa_<qid>_done を自動生成する。
    SSH 自体が失敗してパース結果が空のときは GradeError を送出する。"""
    if not checks:
        return []
    script = build_check_script(checks, cfg, qid=qid, helper_cmds=helper_cmds)
    rc, out, err = ssh_run(cfg, ["bash", "-s"], stdin_data=script, timeout=40)
    parsed = {}
    for line in out.splitlines():
        if "\t" in line:
            cid, _, code = line.partition("\t")
            code = code.strip()
            parsed[cid] = int(code) if code.lstrip("-").isdigit() else -1
    if rc != 0 and not parsed:
        # スクリプト自体が流せなかった（接続不可・鍵エラー等）
        raise GradeError(err.strip() or ("ssh exit %d" % rc))
    results = []
    for c in checks:
        cid = str(c.get("id", ""))
        results.append({"id": cid, "exitCode": parsed.get(cid, -1)})
    return results


# ---------------------------------------------------------------------------
# AI チャット（Anthropic Claude）
# ---------------------------------------------------------------------------
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

CHAT_SYSTEM_BASE = (
    "あなたは RHEL 10 / RHCSA EX200 試験対策の優秀な家庭教師です。\n"
    "受講者は実機 VM（ServerA = 192.0.2.10、ServerB = 192.0.2.11、\n"
    "OS ディスク nvme0n1、追加ディスク nvme0n2/n3 各 8GB）で学習中です。\n"
    "回答は日本語で、コマンドは ```bash``` で囲み、各オプションの意味も短く解説してください。\n"
    "RHEL 10 (RHCSA EX200) で実際に使えるコマンドのみを示し、不確実な点は明示してください。"
)

CHAT_MODE_INSTRUCTIONS = {
    "hint": (
        "【モード: ヒント】受講者は自力で解こうとしています。\n"
        "・**模範解答コマンドそのものは出さない**。アプローチ・調べるべき man ページ・関連概念のヒントだけ。\n"
        "・「次に何を試すべきか」を 1〜2 個示し、結果を見てさらに導く形で。"
    ),
    "explain": (
        "【モード: 解説】受講者は理解を深めたい状態。\n"
        "・コマンドの各オプション・引数・記号（`{}`、`\\;`、`-r` 等）を逐条解説。\n"
        "・関連トピック（再起動後の永続性、SELinux、firewalld など）への波及も触れる。"
    ),
    "debug": (
        "【モード: エラー診断】受講者がコマンドを実行してエラーが出た状態。\n"
        "・受講者が貼ったエラーメッセージから根本原因を推定。\n"
        "・確認すべきコマンド（`ls -Z`、`getenforce`、`systemctl status` 等）を提示。\n"
        "・SELinux / firewalld / partprobe 忘れなど RHCSA で頻出のミスを優先的に疑う。"
    ),
}


def build_chat_system_prompt(qctx, mode):
    """問題コンテキスト + モード別指示でシステムプロンプトを組み立てる。
    qctx: load_question_contexts() の 1 エントリ。None なら問題なしモード。"""
    parts = [CHAT_SYSTEM_BASE]
    parts.append(CHAT_MODE_INSTRUCTIONS.get(mode, CHAT_MODE_INSTRUCTIONS["explain"]))
    if qctx:
        ctx_lines = []
        ctx_lines.append("\n--- 受講者が今開いている問題 ---")
        if qctx.get("test") and qctx.get("qno"):
            ctx_lines.append("ID: Test %s Q%s" % (qctx["test"], qctx["qno"]))
        if qctx.get("category"):
            ctx_lines.append("カテゴリ: %s" % qctx["category"])
        ctx_lines.append("タイトル: %s" % qctx.get("title", ""))
        ctx_lines.append("問題文: %s" % qctx.get("prompt", ""))
        if qctx.get("lab"):
            ctx_lines.append("ラボ環境:")
            for line in qctx["lab"]:
                ctx_lines.append("  - %s" % line)
        # ヒントモードでは模範解答を伏せる
        if mode != "hint" and qctx.get("solutionText"):
            ctx_lines.append("\n模範解答（参考、必要に応じて引用してよい）:")
            ctx_lines.append(qctx["solutionText"])
        if mode != "hint" and qctx.get("pitfalls"):
            ctx_lines.append("\n落とし穴・試験のポイント:")
            for p in qctx["pitfalls"][:6]:        # 長すぎないよう先頭 6 件
                ctx_lines.append("  - %s" % p)
        parts.append("\n".join(ctx_lines))
    return "\n\n".join(parts)


def anthropic_chat_stream(cfg, system, messages, write_chunk):
    """Anthropic API を stream=true で呼び、text_delta だけを write_chunk(text) で渡す。
    write_chunk は SSE フォーマットへ整形してブラウザに送る役目。
    例外時は最後に write_chunk("[ERROR] ...") を呼んで終了。"""
    api_key = cfg.get("anthropic_api_key")
    if not api_key:
        write_chunk("[ERROR] anthropic_api_key が vmbridge.config.json に未設定です。")
        return
    body = json.dumps({
        "model": cfg.get("anthropic_model", "claude-haiku-4-5"),
        "max_tokens": 2048,
        "system": system,
        "messages": messages,
        "stream": True,
    }).encode("utf-8")
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=body,
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
            "accept": "text/event-stream",
        },
    )
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            buf = ""
            for raw in resp:
                line = raw.decode("utf-8", errors="replace")
                buf += line
                # SSE は空行で 1 イベント区切り
                if "\n\n" in buf or buf.endswith("\n"):
                    # 1 行ずつ処理（buf が大きくなりすぎないよう逐次解析）
                    pass
                if line.startswith("data: "):
                    try:
                        evt = json.loads(line[6:].strip())
                    except json.JSONDecodeError:
                        continue
                    if evt.get("type") == "content_block_delta":
                        delta = evt.get("delta", {})
                        if delta.get("type") == "text_delta":
                            t = delta.get("text", "")
                            if t:
                                write_chunk(t)
                    elif evt.get("type") == "message_stop":
                        return
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = str(e)
        write_chunk("[ERROR] HTTP %d: %s" % (e.code, err_body[:500]))
    except Exception as e:                                   # noqa: BLE001
        write_chunk("[ERROR] %s" % e)


# ---------------------------------------------------------------------------
# HTTP ハンドラ
# ---------------------------------------------------------------------------
class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "rhcsa-vmbridge/1.0"

    # ---- CORS / Origin ----
    def _origin_allowed(self):
        origin = self.headers.get("Origin")
        if origin is None:
            return True, None          # 非ブラウザ（curl 等）。ローカルツール扱いで許可
        if origin in ALLOWED_ORIGINS:
            return True, origin
        return False, origin

    def _send_json(self, status, payload, origin=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers",
                             "Content-Type, X-RHCSA-Bridge-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        ok, origin = self._origin_allowed()
        if not ok:
            self._send_json(403, {"error": "origin not allowed"})
            return
        self.send_response(204)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers",
                             "Content-Type, X-RHCSA-Bridge-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        ok, origin = self._origin_allowed()
        if not ok:
            self._send_json(403, {"error": "origin not allowed"})
            return
        if self.path.split("?")[0] == "/status":
            st = vm_status(CONFIG)
            payload = {
                "ok": bool(st.get("ok")),
                "vm": "reachable" if st.get("ok") else "unreachable",
                "hostname": st.get("hostname", ""),
                "error": st.get("error", ""),
                "token": TOKEN,             # 正当な Origin のみレスポンスを読める（CORS）
                "chat": bool(CONFIG and CONFIG.get("anthropic_api_key")),
                "chatModel": (CONFIG.get("anthropic_model") if CONFIG else ""),
            }
            self._send_json(200, payload, origin)
        else:
            self._send_json(404, {"error": "not found"}, origin)

    def do_POST(self):
        ok, origin = self._origin_allowed()
        if not ok:
            self._send_json(403, {"error": "origin not allowed"})
            return
        path = self.path.split("?")[0]
        if path == "/grade":
            self._handle_grade(origin)
            return
        if path == "/chat":
            self._handle_chat(origin)
            return
        self._send_json(404, {"error": "not found"}, origin)

    def _read_json_body(self, origin, max_size=4096):
        """共通：token 検証 + JSON ボディ読込。失敗時は HTTP レスポンスを返して None を返す。"""
        if self.headers.get("X-RHCSA-Bridge-Token") != TOKEN:
            self._send_json(403, {"error": "invalid bridge token"}, origin)
            return None
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype != "application/json":
            self._send_json(415, {"error": "JSON only"}, origin)
            return None
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > max_size:
            self._send_json(400, {"error": "bad request body"}, origin)
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "invalid JSON"}, origin)
            return None

    def _handle_grade(self, origin):
        req = self._read_json_body(origin)
        if req is None:
            return
        qid = req.get("questionId")
        phase = req.get("phase", "live")
        if not isinstance(qid, str) or qid not in GRADERS:
            self._send_json(404, {"error": "unknown questionId"}, origin)
            return
        if phase not in ("live", "reboot"):
            self._send_json(400, {"error": "phase must be live or reboot"}, origin)
            return
        if CONFIG is None:
            self._send_json(503, {"error": "VM 未設定（vmbridge.config.json）"}, origin)
            return
        grader = GRADERS[qid]
        checks = [c for c in grader["checks"] if c.get("scope", "live") == phase]
        # helperCmds は live phase でのみ自動実行（reboot phase は再起動後の永続確認なので
        # その場の helper 生成は意味がない）。
        # auto_helper=false（POST body）で OFF にできる。grader_audit の clean モード採点で
        # 「helper 自動実行による false positive」を排除するために使う。
        auto_helper = req.get("auto_helper", True)
        helper_cmds = (grader.get("helperCmds")
                       if (phase == "live" and auto_helper) else None)
        try:
            results = run_grade(CONFIG, checks, qid=qid, helper_cmds=helper_cmds)
        except GradeError as e:
            self._send_json(502, {"error": "VM 実行エラー: " + str(e)}, origin)
            return
        self._send_json(200, {"questionId": qid, "phase": phase,
                              "results": results}, origin)

    def _handle_chat(self, origin):
        # チャット履歴は最大 32KB まで
        req = self._read_json_body(origin, max_size=32768)
        if req is None:
            return
        if CONFIG is None or not CONFIG.get("anthropic_api_key"):
            self._send_json(503, {"error": "AI チャット未設定（vmbridge.config.json の anthropic_api_key）"}, origin)
            return
        qid = req.get("questionId")
        mode = req.get("mode", "explain")
        if mode not in CHAT_MODE_INSTRUCTIONS:
            self._send_json(400, {"error": "mode は hint/explain/debug のいずれか"}, origin)
            return
        messages = req.get("messages") or []
        if not isinstance(messages, list) or not messages:
            self._send_json(400, {"error": "messages 配列が空"}, origin)
            return
        # 各 message を { role: user|assistant, content: str } のみに正規化（信頼済みの形だけ通す）
        clean_msgs = []
        for m in messages[-20:]:                    # 最大 20 turn
            role = m.get("role")
            content = m.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                clean_msgs.append({"role": role, "content": content[:8000]})  # 1 メッセージ 8KB 上限
        if not clean_msgs:
            self._send_json(400, {"error": "有効な messages がない"}, origin)
            return
        # 問題コンテキスト（信頼済み）を解決
        qctx = QCONTEXTS.get(qid) if isinstance(qid, str) else None
        system = build_chat_system_prompt(qctx, mode)

        # SSE ストリーミングレスポンスを開始
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()

        def write_chunk(text):
            try:
                # SSE: data: <json>\n\n
                payload = json.dumps({"text": text}, ensure_ascii=False)
                self.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
                self.wfile.flush()
            except Exception:                       # noqa: BLE001
                pass

        anthropic_chat_stream(CONFIG, system, clean_msgs, write_chunk)
        # 完了マーカー
        try:
            self.wfile.write(b"event: done\ndata: {}\n\n")
            self.wfile.flush()
        except Exception:                            # noqa: BLE001
            pass

    def log_message(self, fmt, *args):
        # /status はアプリが 20 秒ごとに叩くヘルスチェック。ログが流れて
        # 実際の採点ログが埋もれるため抑制する（全て見たい場合は下を消す）。
        if args and isinstance(args[0], str) and "/status" in args[0]:
            return
        sys.stderr.write("[vmbridge] " + (fmt % args) + "\n")


# ---------------------------------------------------------------------------
# 起動
# ---------------------------------------------------------------------------
CONFIG, CONFIG_ERR = load_config()
GRADERS = load_graders()
QCONTEXTS = load_question_contexts()
ALLOWED_ORIGINS = (CONFIG.get("allowed_origins") if CONFIG else DEFAULT_ORIGINS)
BRIDGE_PORT = (CONFIG.get("bridge_port") if CONFIG else 8770)


def main():
    print("=" * 60)
    print(" RHCSA10 exam practice — SSH ブリッジ (vmbridge.py)")
    print("=" * 60)
    if CONFIG is None:
        print(" [設定なし] %s" % CONFIG_ERR)
        print("  → /status は ok:false を返します。設定後に再起動してください。")
    else:
        print(" VM      : %s@%s:%s (鍵 %s)" % (
            CONFIG["ssh_user"], CONFIG["ssh_host"],
            CONFIG["ssh_port"], CONFIG["ssh_key"]))
    print(" 待受    : http://127.0.0.1:%d  (127.0.0.1 のみ)" % BRIDGE_PORT)
    print(" 許可Origin: %s" % ", ".join(ALLOWED_ORIGINS))
    print(" grader  : %d 問の信頼済み定義を読み込み済み" % len(GRADERS))
    print(" qcontext: %d 問の問題コンテキスト（AI チャット用）" % len(QCONTEXTS))
    chat_on = bool(CONFIG and CONFIG.get("anthropic_api_key"))
    print(" AI chat : %s (model=%s)" % (
        "有効" if chat_on else "無効（anthropic_api_key 未設定）",
        (CONFIG.get("anthropic_model") if CONFIG else "")))
    print(" token   : %s" % TOKEN)
    print(" 停止    : Ctrl+C")
    print("=" * 60)
    httpd = ThreadingHTTPServer(("127.0.0.1", BRIDGE_PORT), BridgeHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n停止します。")
    finally:
        httpd.server_close()
        # SSH マスター接続を閉じる
        if CONFIG is not None:
            subprocess.run(ssh_base(CONFIG)[:-1] + ["-O", "exit",
                           "%s@%s" % (CONFIG["ssh_user"], CONFIG["ssh_host"])],
                           capture_output=True)


if __name__ == "__main__":
    main()
