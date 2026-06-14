#!/usr/bin/env python3
"""grader_audit.py — 全 193 問の grader 品質を機械検証するハーネス

【使い方】
  1. VM を「clean-base」snapshot に戻す (rhcsa-revert.sh または手動)
  2. vmbridge.py を起動 (rhcsa)
  3. 本スクリプトを実行: python3 app/tools/grader_audit.py [--mode clean|solution]
  4. 結果を見て false positive (= clean なのに点数が出る) を発見

【モード】
  --mode clean    (既定) 全問題が 0 点になるか検証。
                   1 点以上付く問題 = false positive 候補 = grader 設計に隙
  --mode solution 模範解答済み状態で全問題が 100% になるか検証 (未実装)

【出力】
  問題ごとに earned/max と check ごとの pass/fail を表示。
  最後に false positive サマリ。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
QUESTIONS_JS = ROOT / "app/js/data/questions.js"
BRIDGE = "http://127.0.0.1:8770"
ORIGIN = "http://localhost:8765"

# clean 状態で 0 点想定だが、システム由来で稀に小点数が出る許容
# 例: SELinux が常に Enforcing で「SELinux Boolean ON」が偶発合格 等
TOLERANCE_PCT = 15  # 15% 以下なら許容 (それ以上は要確認)


def load_questions():
    src = QUESTIONS_JS.read_text(encoding="utf-8")
    m = re.search(r"const QUESTIONS = (\[[\s\S]*?\]);\nif", src)
    return json.loads(m.group(1))


def get_bridge_status():
    try:
        req = urllib.request.Request(f"{BRIDGE}/status",
                                     headers={"Origin": ORIGIN})
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)
    except (urllib.error.URLError, OSError) as e:
        print(f"ERROR: vmbridge に接続できません ({BRIDGE}): {e}")
        print("→ vmbridge.py が起動しているか確認 (rhcsa 実行 or python3 vmbridge.py)")
        sys.exit(1)


def grade(qid: str, token: str, auto_helper: bool = True) -> dict:
    body = {"questionId": qid, "phase": "live"}
    if not auto_helper:
        body["auto_helper"] = False
    req = urllib.request.Request(
        f"{BRIDGE}/grade",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-RHCSA-Bridge-Token": token,
            "Origin": ORIGIN,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": f"HTTP {e.code}: {body[:120]}"}
    except (urllib.error.URLError, OSError) as e:
        return {"error": str(e)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["clean", "solution"], default="clean",
                    help="検証モード (clean=0点想定, solution=満点想定)")
    ap.add_argument("--limit", type=int, default=0,
                    help="検証する問題数 (0=全部)")
    ap.add_argument("--qid", action="append",
                    help="特定 qid のみ検証 (複数指定可)")
    ap.add_argument("--delay", type=float, default=0.2,
                    help="採点間隔秒 (VM 負荷軽減、既定 0.2)")
    ap.add_argument("--out", default=None,
                    help="採点結果を JSON Lines で保存するパス (例: docs/audit/raw_clean.jsonl)")
    ap.add_argument("--no-auto-helper", action="store_true",
                    help="vmbridge の helper 自動実行を OFF にする（audit mode、grader 真の精度を測る）")
    args = ap.parse_args()

    print(f"=== RHCSA10 grader 監査 ({args.mode} mode) ===\n")

    # vmbridge 接続確認
    st = get_bridge_status()
    if not st.get("ok"):
        print(f"WARN: VM 未到達 ({st.get('error', 'unknown')})")
        print("→ VM が起動済みで SSH 鍵認証が通っているか確認")
        sys.exit(1)
    token = st["token"]
    print(f"vmbridge OK / VM: {st.get('hostname', '?')}")

    # 問題読み込み
    qs = load_questions()
    targets = [q for q in qs if q.get("autoGradeReady")]
    if args.qid:
        targets = [q for q in targets if q["id"] in args.qid]
    elif args.limit > 0:
        targets = targets[:args.limit]
    print(f"対象: {len(targets)} 問\n")

    # 各問題を採点
    results = []

    def _write_out(idx: int, payload: dict) -> None:
        """`--out` 指定時、payload を JSONL に追記。idx==1 のときだけ truncate。"""
        if not args.out:
            return
        import pathlib
        outp = pathlib.Path(args.out)
        outp.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if idx > 1 else "w"
        with open(outp, mode, encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")

    for i, q in enumerate(targets, 1):
        qid = q["id"]
        print(f"[{i}/{len(targets)}] {qid:8} ", end="", flush=True)
        r = grade(qid, token, auto_helper=not args.no_auto_helper)
        if "error" in r:
            print(f"ERROR: {r['error']}")
            err_entry = {"qid": qid, "error": r["error"]}
            results.append(err_entry)
            _write_out(i, err_entry)
            time.sleep(args.delay)
            continue

        # earned 計算
        checks_by_id = {c["id"]: c for c in q["grader"]["checks"]}
        earned = 0
        per_check = []
        for chk_result in r.get("results", []):
            cid = chk_result["id"]
            passed = chk_result["exitCode"] == 0
            score = checks_by_id.get(cid, {}).get("score", 0)
            if passed:
                earned += score
            per_check.append((cid, passed, score))
        max_score = q.get("maxScore", 0)
        pct = earned / max_score * 100 if max_score else 0

        # 表示
        marker = "○" if (args.mode == "clean" and earned == 0) or \
                       (args.mode == "solution" and earned == max_score) else \
                 "△" if (args.mode == "clean" and pct <= TOLERANCE_PCT) else "×"
        print(f"{marker} {earned:3}/{max_score:3} ({pct:5.1f}%) "
              f"checks {sum(1 for _, p, _ in per_check if p)}/{len(per_check)}")

        results.append({
            "qid": qid,
            "title": q.get("title", "")[:40],
            "category": q.get("category", ""),
            "earned": earned,
            "max": max_score,
            "pct": pct,
            "per_check": per_check,
            "graderQuality": q.get("graderQuality", "?"),
        })
        _write_out(i, results[-1])
        time.sleep(args.delay)

    # サマリ
    print("\n" + "=" * 70)
    print(f" 監査結果サマリ ({args.mode} mode)")
    print("=" * 70)
    print(f"総採点: {len(results)} 問")
    err_n = sum(1 for r in results if "error" in r)
    print(f"エラー: {err_n} 問")
    if err_n:
        print("\n--- エラー一覧 ---")
        for r in results:
            if "error" in r:
                print(f"  {r['qid']}: {r['error']}")

    valid = [r for r in results if "error" not in r]

    if args.mode == "clean":
        # clean 状態で earned > 0 = false positive 候補
        false_pos = sorted([r for r in valid if r["earned"] > 0],
                           key=lambda r: -r["pct"])
        critical = [r for r in false_pos if r["pct"] > TOLERANCE_PCT]
        tolerable = [r for r in false_pos if r["pct"] <= TOLERANCE_PCT]

        print(f"\n--- 致命 (false positive 率 > {TOLERANCE_PCT}%) {len(critical)} 件 ---")
        for r in critical:
            print(f"  × {r['qid']:8} [{r['graderQuality']}] {r['earned']:3}/{r['max']:3} "
                  f"({r['pct']:5.1f}%) — {r['title']}")
            passed_checks = [cid for cid, p, _ in r["per_check"] if p]
            if passed_checks:
                print(f"     合格 check: {', '.join(passed_checks)}")

        print(f"\n--- 許容 (~{TOLERANCE_PCT}% 程度) {len(tolerable)} 件 ---")
        for r in tolerable[:20]:
            print(f"  △ {r['qid']:8} [{r['graderQuality']}] {r['earned']:3}/{r['max']:3} "
                  f"({r['pct']:5.1f}%) — {r['title']}")
        if len(tolerable) > 20:
            print(f"  ... 他 {len(tolerable) - 20} 件")

        print(f"\n--- 完全 0 点 (理想) {len(valid) - len(false_pos)} 件 ---")

        # カテゴリ別集計
        by_cat = defaultdict(list)
        for r in valid:
            by_cat[r["category"]].append(r)
        print("\n--- カテゴリ別 false positive 率 ---")
        for cat in sorted(by_cat):
            rs = by_cat[cat]
            fp_n = sum(1 for r in rs if r["earned"] > 0)
            avg = sum(r["pct"] for r in rs) / len(rs) if rs else 0
            print(f"  {cat:18} {fp_n:3}/{len(rs):3} (avg {avg:4.1f}%)")

    elif args.mode == "solution":
        # solution 状態で earned < max = false negative
        false_neg = sorted([r for r in valid if r["earned"] < r["max"]],
                          key=lambda r: r["pct"])
        print(f"\n--- 満点未達 (false negative) {len(false_neg)} 件 ---")
        for r in false_neg[:30]:
            print(f"  × {r['qid']:8} {r['earned']:3}/{r['max']:3} "
                  f"({r['pct']:5.1f}%) — {r['title']}")

    # 終了コード
    if args.mode == "clean" and any(r.get("pct", 0) > TOLERANCE_PCT for r in valid):
        sys.exit(2)  # 致命 false positive あり
    sys.exit(0)


if __name__ == "__main__":
    main()
