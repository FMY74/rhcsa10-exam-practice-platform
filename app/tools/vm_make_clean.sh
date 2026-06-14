#!/usr/bin/env bash
# vm_make_clean.sh — 学習 VM を「本試験前提のクリーン状態」にする（破壊的）。
#
# 目的: 各 RHCSA 問題が実際に「作業」になるよう、事前設定済みのものを除去する。
#   消す : task パッケージ / local.repo / DVD の事前マウント(+fstab) / タスク生成物・ユーザー
#   残す : ネットワーク(ens160)+SSH鍵 / lvm2 等のシステム基盤 / chrony・rsyslog 等の標準 / DVD 接続(sr0)
#
# 使い方（ServerA で実行→確認→ VMware Fusion で新しい clean snapshot を作成）:
#   ssh -i ~/.ssh/rhcsa_vm root@192.0.2.10 bash -s < app/tools/vm_make_clean.sh
#   その後  app/tools/vm_clean_check.sh  でクリーン度を確認してから snapshot を取る。
#
# ⚠️ 破壊的。実行前に「現在の状態の snapshot」を取っておくこと（失敗時に戻せる）。
set -u

echo "=== [安全確認] 触らないもの: network/ens160, sshd, root SSH key, lvm2, /(boot) ==="

echo; echo "=== [1] task パッケージを削除（システム基盤 lvm2/chrony/rsyslog/vim は残す） ==="
REMOVE_PKGS="httpd flatpak tuned nfs-utils autofs vdo vsftpd nmap-ncat nmap podman at"
for p in $REMOVE_PKGS; do
  if rpm -q "$p" >/dev/null 2>&1; then
    echo "removing: $p"
    dnf remove -y "$p" >/dev/null 2>&1 && echo "  -> removed $p" || echo "  -> 失敗/依存で保留 $p"
  fi
done

echo; echo "=== [2] local.repo を削除（repo 設定を本当の作業にする） ==="
[ -f /etc/yum.repos.d/local.repo ] && rm -f /etc/yum.repos.d/local.repo && echo "removed local.repo" || echo "local.repo は既に無い"
dnf clean all >/dev/null 2>&1 || true

echo; echo "=== [3] DVD の事前マウントを解除（マウント作業も student に任せる。sr0 は接続のまま） ==="
# fstab から /dev/sr0 行を除去
if grep -q '/dev/sr0' /etc/fstab 2>/dev/null; then
  cp -a /etc/fstab /etc/fstab.bak.$(date +%s) 2>/dev/null || true
  grep -v '/dev/sr0' /etc/fstab > /etc/fstab.tmp && mv /etc/fstab.tmp /etc/fstab && echo "fstab から /dev/sr0 行を除去"
fi
mountpoint -q /mnt && umount /mnt 2>/dev/null && echo "/mnt をアンマウント" || echo "/mnt は未マウント"

echo; echo "=== [4] タスク生成物の残骸を除去（存在すれば） ==="
for d in /find /opt/dev-data /vdo_data /mylv /groups /shares /data/public; do
  [ -e "$d" ] && rm -rf "$d" && echo "rm $d" || true
done
rm -f /usr/local/bin/*.sh /root/ssh_hosts.txt /root/config_backup.tar.gz /var/tmp/fstab_copy 2>/dev/null || true

echo; echo "=== [5] タスク用ユーザー/グループを除去（存在すれば。標準ユーザーは触らない） ==="
for u in alex harry sam john sarah peter carl dan natasha; do
  id "$u" >/dev/null 2>&1 && userdel -r "$u" 2>/dev/null && echo "userdel $u" || true
done
for g in developers accounting finance sysadmin; do
  getent group "$g" >/dev/null 2>&1 && groupdel "$g" 2>/dev/null && echo "groupdel $g" || true
done

echo; echo "=== [6] 追加ディスクのパーティションを消去（nvme0n2/n3 をまっさらに） ==="
for disk in /dev/nvme0n2 /dev/nvme0n3; do
  if [ -b "$disk" ]; then
    # この task ディスク由来の swap/マウントだけ解除（OS の rhel-swap は触らない）
    for part in "$disk" "$disk"p*; do
      [ -b "$part" ] || continue
      swapoff "$part" 2>/dev/null || true
      umount "$part" 2>/dev/null || true
    done
    wipefs -a "$disk" >/dev/null 2>&1 && echo "wipefs $disk" || echo "$disk: wipe 失敗/不要"
  fi
done

echo; echo "=== [7] シェル履歴を消去（練習履歴が snapshot に焼き込まれて採点を汚染しないように） ==="
for h in /root/.bash_history /home/*/.bash_history; do
  [ -f "$h" ] && truncate -s 0 "$h" && echo "truncated $h" || true
done

echo; echo "=== 完了。次に app/tools/vm_clean_check.sh で確認 → 問題なければ VMware Fusion で新 snapshot を取得 ==="
