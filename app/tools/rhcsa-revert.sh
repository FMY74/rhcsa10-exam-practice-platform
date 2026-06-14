#!/usr/bin/env bash
# rhcsa-revert.sh — RHCSA10 学習 VM を clean snapshot に戻して再起動
#
# 使い方:
#   ./rhcsa-revert.sh                 # 既定 snapshot "RHCSA10-exam-baseline" に戻す
#   ./rhcsa-revert.sh <snapshot-name> # 任意の snapshot に戻す
#   ./rhcsa-revert.sh --a-only        # ServerA だけ戻す
#   ./rhcsa-revert.sh --b-only        # ServerB だけ戻す
#
# 設定:
#   下の SERVERA_VMX / SERVERB_VMX を自分の VM パスに合わせて編集してください。
#   `vmrun list` で動作中の VM パスを確認できます。

set -eu

# ---- 設定 (自分の環境に合わせて編集) ----
SERVERA_VMX="${SERVERA_VMX:-$HOME/Virtual Machines.localized/ServerA.vmwarevm/RHCSA10 practice1.vmx}"
SERVERB_VMX="${SERVERB_VMX:-$HOME/Virtual Machines.localized/ServerB.vmwarevm/RHCSA10 practice2.vmx}"
SERVERA_IP="${SERVERA_IP:-192.0.2.10}"
SERVERB_IP="${SERVERB_IP:-192.0.2.11}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/rhcsa_vm}"
# v3 (2026-06-10): bash_history 消去＋CD startConnected＋ISO を TCC 保護外パスへ移設
#（旧 RHCSA10-exam-baseline は fallback として保持。ISO の正本は
#  ~/Virtual Machines/rhel-10.1-x86_64-dvd.iso＝Documents 配下は
#  headless 起動の VMware が TCC で開けない）
DEFAULT_SNAPSHOT="${DEFAULT_SNAPSHOT:-RHCSA10-exam-baseline-v3}"

# ---- 引数解析 ----
TARGETS=("a" "b")
SNAPSHOT="${DEFAULT_SNAPSHOT}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --a-only) TARGETS=("a"); shift ;;
    --b-only) TARGETS=("b"); shift ;;
    --help|-h)
      head -16 "$0" | tail -15
      exit 0
      ;;
    *)
      SNAPSHOT="$1"
      shift
      ;;
  esac
done

# ---- vmrun の場所を探す ----
VMRUN=$(command -v vmrun || echo "/Applications/VMware Fusion.app/Contents/Public/vmrun")
if [[ ! -x "$VMRUN" ]]; then
  echo "ERROR: vmrun コマンドが見つかりません"
  echo "→ VMware Fusion がインストールされているか確認、または \$VMRUN を export して指定"
  exit 1
fi

# ---- snapshot 存在確認 ----
check_snapshot() {
  local vmx="$1"
  if ! "$VMRUN" listSnapshots "$vmx" 2>/dev/null | grep -q "^${SNAPSHOT}$"; then
    echo "ERROR: snapshot '${SNAPSHOT}' が $vmx に存在しません"
    echo "  利用可能な snapshot:"
    "$VMRUN" listSnapshots "$vmx" | sed 's/^/    /'
    exit 1
  fi
}

# ---- revert + 起動 ----
revert_vm() {
  local label="$1" vmx="$2" ip="$3"
  echo "==> ${label} (${vmx})"
  check_snapshot "$vmx"
  echo "    revertToSnapshot: ${SNAPSHOT}"
  "$VMRUN" revertToSnapshot "$vmx" "$SNAPSHOT"
  echo "    start (nogui)"
  "$VMRUN" start "$vmx" nogui

  # SSH 接続待ち
  echo -n "    SSH 接続待ち "
  local n=0
  while (( n < 60 )); do
    if ssh -i "$SSH_KEY" \
           -o ConnectTimeout=3 \
           -o BatchMode=yes \
           -o StrictHostKeyChecking=no \
           -o UserKnownHostsFile=/dev/null \
           root@${ip} 'echo ok' >/dev/null 2>&1; then
      echo "✓"
      return 0
    fi
    echo -n "."
    sleep 2
    n=$((n+1))
  done
  echo " ✗ タイムアウト (2 分)"
  exit 1
}

# ---- 実行 ----
echo "===== RHCSA10 VM revert (${SNAPSHOT}) ====="
for t in "${TARGETS[@]}"; do
  case "$t" in
    a) revert_vm "ServerA" "$SERVERA_VMX" "$SERVERA_IP" ;;
    b) revert_vm "ServerB" "$SERVERB_VMX" "$SERVERB_IP" ;;
  esac
done

echo ""
echo "===== 完了 ====="
echo "次のステップ:"
echo "  1. vmbridge.py が起動中なら、状態が反映されるまで 10〜20 秒待つ"
echo "  2. ブラウザで Cmd+Shift+R でハードリロード"
echo "  3. 採点品質を確認したい場合: python3 app/tools/grader_audit.py"
