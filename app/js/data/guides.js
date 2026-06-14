// Study guides for the public demo — ORIGINAL, deliberately brief.
// The full per-domain guides in the private project are derived from
// third-party paid materials and are NOT included here.
const GUIDES = [
 {
  slug: "00-overview",
  title: "Overview (demo)",
  html: "<h1>RHCSA 10 exam practice — demo build</h1><p>This is a public, code-only demo of a personal study tool for the RHEL 10 RHCSA (EX200) exam. The original question bank and study notes are excluded for copyright; what you see here runs on a small set of <strong>original sample tasks</strong> so the engine can be explored end to end.</p><p>Pick a domain under <em>分野別ドリル</em> (Drill), open a task, and switch between <strong>Learn</strong> and <strong>Solve</strong> modes. In <em>模擬試験</em> (Exam) you can run the timed sample exam and self-assess. The optional VM auto-grader (SSH into real practice VMs) needs local setup — see the project README.</p>"
 },
 {
  slug: "01-essential-tools",
  title: "Essential Tools",
  html: "<h1>Essential Tools</h1><p>Core commands that show up across the whole exam: <code>find</code>, <code>grep</code>, <code>tar</code>, redirection and links.</p><pre><code class=\"lang-bash\"># files larger than 1 MiB, copied while preserving attributes\nfind /var/log -type f -size +1M -exec cp -p {} /root/biglogs/ \\;\n\n# archive and extract\ntar -czf /root/etc.tar.gz /etc\ntar -xzf /root/etc.tar.gz -C /restore/</code></pre><blockquote>-size +1M means strictly larger than 1 MiB; cp -p preserves mode and timestamps.</blockquote>"
 },
 {
  slug: "03-local-storage",
  title: "Local Storage",
  html: "<h1>Local Storage (LVM)</h1><p>The usual flow is disk &rarr; partition &rarr; PV &rarr; VG &rarr; LV &rarr; filesystem &rarr; persistent mount.</p><pre><code class=\"lang-bash\">pvcreate /dev/sdb1\nvgcreate vg_demo /dev/sdb1\nlvcreate -n lv_demo -L 1G vg_demo\nmkfs.ext4 /dev/vg_demo/lv_demo\nUUID=$(blkid -s UUID -o value /dev/vg_demo/lv_demo)\necho \"UUID=$UUID /mnt/demo ext4 defaults 0 0\" >> /etc/fstab\nmount -a</code></pre><blockquote>Always test /etc/fstab with <code>mount -a</code> before rebooting, and mount by UUID.</blockquote>"
 },
 {
  slug: "06-networking",
  title: "Networking",
  html: "<h1>Networking (nmcli)</h1><p>Set a static IPv4 address on a connection and make it persist.</p><pre><code class=\"lang-bash\">nmcli con mod ens3 ipv4.addresses 192.0.2.50/24\nnmcli con mod ens3 ipv4.gateway 192.0.2.1\nnmcli con mod ens3 ipv4.dns 192.0.2.1\nnmcli con mod ens3 ipv4.method manual\nnmcli con up ens3</code></pre><blockquote>Without <code>ipv4.method manual</code> the interface stays on DHCP.</blockquote>"
 },
 {
  slug: "07-users-groups",
  title: "Users & Groups",
  html: "<h1>Users &amp; Groups</h1><p>Create accounts and groups and manage account aging.</p><pre><code class=\"lang-bash\">groupadd engineering\nuseradd -G engineering dev1\npasswd dev1\nchage -E 2030-12-31 dev1   # account expiry\nchage -M 60 dev1           # max password age</code></pre><blockquote>-G adds a supplementary group; -g sets the primary group.</blockquote>"
 },
 {
  slug: "08-security",
  title: "Security",
  html: "<h1>Security (firewalld &amp; SELinux)</h1><p>Open services in the firewall and keep SELinux enforcing.</p><pre><code class=\"lang-bash\"># firewalld\nfirewall-cmd --add-service=http --permanent\nfirewall-cmd --reload\nfirewall-cmd --list-services\n\n# SELinux\ngetenforce\nsetenforce 1</code></pre><blockquote>Use --permanent so firewall rules survive a reload and reboot.</blockquote>"
 }
];
if (typeof module !== 'undefined') { module.exports = GUIDES; }
