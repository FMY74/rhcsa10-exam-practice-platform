#!/usr/bin/env bash
# rhcsa_done — RHCSA10 学習アプリ採点補助コマンド
# VM (ServerA / ServerB) の /usr/local/bin/rhcsa_done に配置する。
#
# 学習者は問題完了後にこの関数を 1 行呼ぶだけで、grader が必要な状態情報を
# /tmp/.rhcsa_<qid>_done に記録できる。grader はその出力ファイルを grep する。
#
# 使い方:
#   rhcsa_done <qid> [<cmd1> [<cmd2> ...]]
#
# 例:
#   rhcsa_done t1q22 'ps -eo pid,ni,comm | grep sleep' 'history | tail -20'
#
# 出力先: /tmp/.rhcsa_<qid>_done
# 既存ファイルは上書きされる (再採点用)
#
# セキュリティ:
#   - qid は ^t[0-9]+q[0-9]+$ のみ受け入れる (任意ファイル書き込み防止)
#   - 出力先は /tmp/ 固定 (snapshot revert で自動消去される)
#   - cmd は eval される (学習用ツールなので意図的に許容)

set -u

rhcsa_done() {
  local qid="${1:-}"
  shift || true

  # qid 形式検証
  if [[ ! "${qid}" =~ ^t[0-9]+q[0-9]+$ ]]; then
    echo "Error: qid は 't<test>q<no>' 形式で指定 (例: t1q22)" >&2
    return 1
  fi

  local outfile="/tmp/.rhcsa_${qid}_done"
  {
    echo "qid:${qid}"
    echo "at:$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
    echo "host:$(hostname 2>/dev/null || echo unknown)"
    echo "user:$(id -un 2>/dev/null || echo unknown)"
    if [[ "$#" -eq 0 ]]; then
      echo ""
      echo "=== (no commands) ==="
    else
      for cmd in "$@"; do
        echo ""
        echo "=== ${cmd} ==="
        eval "${cmd}" 2>&1 || true
      done
    fi
  } > "${outfile}" 2>/dev/null

  # 採点補助ファイルは誰でも読めるように (vmbridge は root で SSH するが念のため)
  chmod 644 "${outfile}" 2>/dev/null || true

  echo "✓ 採点補助ファイル: ${outfile}"
}

# このファイルを source した場合は関数定義のみ
# 直接実行された場合は引数を rhcsa_done に渡す
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  rhcsa_done "$@"
fi
