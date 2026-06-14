// Sample question set — ORIGINAL content written for this public demo.
// The real RHCSA practice dataset (derived from third-party paid materials)
// is intentionally NOT included here for copyright reasons.
// These five tasks exist only to show the engine working end to end.
const QUESTIONS = [
 {
  test: 0, qno: 1, id: "s1",
  category: "users-groups", altCategories: [],
  title: "Create a user and add it to a group",
  prompt: "On ServerA, create a group named 'engineering' and a user 'dev1' that belongs to it as a supplementary group. Make the account expire on 2030-12-31.",
  lab: [
   "ServerA 192.0.2.10/24 — practice VM (example address)",
   "Run every command as root."
  ],
  solutionSource: "sample",
  solutionHtml: "<pre><code class=\"lang-bash\">groupadd engineering\nuseradd -G engineering dev1\nchage -E 2030-12-31 dev1\n\n# verify\nid dev1\nchage -l dev1 | grep -i expire</code></pre>",
  solutionText: "groupadd engineering\nuseradd -G engineering dev1\nchage -E 2030-12-31 dev1\nid dev1\nchage -l dev1 | grep -i expire\n",
  stepCount: 3,
  guideRef: { slug: "07-users-groups", title: "Users & Groups" },
  legacy: false, legacyReason: null,
  difficulty: 1, tags: ["users", "groups"],
  autoGradeReady: false,
  commands: ["useradd", "groupadd", "chage"],
  categoryLabel: "Users & Groups", categoryOfficial: "Manage users and groups",
  source: "sample", maxScore: 10,
  grader: { checks: [] },
  verify: [
   "`id dev1` lists the engineering group.",
   "`chage -l dev1` shows the account expiry date."
  ],
  rebootCheck: "User and group definitions persist across a reboot.",
  pitfalls: [
   "Use -G for a supplementary group; -g would change the primary group instead."
  ]
 },
 {
  test: 0, qno: 2, id: "s2",
  category: "essential-tools", altCategories: [],
  title: "Find large files and copy them, preserving attributes",
  prompt: "Find every regular file under /var/log larger than 1 MiB and copy them into /root/biglogs, keeping their permissions and timestamps.",
  lab: [
   "ServerA 192.0.2.10/24 — practice VM (example address)",
   "Run every command as root."
  ],
  solutionSource: "sample",
  solutionHtml: "<pre><code class=\"lang-bash\">mkdir -p /root/biglogs\nfind /var/log -type f -size +1M -exec cp -p {} /root/biglogs/ \\;\n\n# verify\nls -l /root/biglogs</code></pre>",
  solutionText: "mkdir -p /root/biglogs\nfind /var/log -type f -size +1M -exec cp -p {} /root/biglogs/ \\;\nls -l /root/biglogs\n",
  stepCount: 2,
  guideRef: { slug: "01-essential-tools", title: "Essential Tools" },
  legacy: false, legacyReason: null,
  difficulty: 1, tags: ["find", "cp"],
  autoGradeReady: false,
  commands: ["find", "cp"],
  categoryLabel: "Essential Tools", categoryOfficial: "Understand and use essential tools",
  source: "sample", maxScore: 10,
  grader: { checks: [] },
  verify: [
   "Files larger than 1 MiB from /var/log exist in /root/biglogs.",
   "Copied files keep their original timestamps (cp -p)."
  ],
  rebootCheck: "Copied files persist across a reboot.",
  pitfalls: [
   "-size +1M means strictly larger than 1 MiB (1,048,576 bytes), not megabytes.",
   "cp -p preserves mode/ownership/timestamps; plain cp does not."
  ]
 },
 {
  test: 0, qno: 3, id: "s3",
  category: "local-storage", altCategories: [],
  title: "Create an LVM logical volume and mount it persistently",
  prompt: "On the spare disk /dev/sdb, build a volume group 'vg_demo' and a 1 GiB logical volume 'lv_demo'. Format it ext4 and mount it at /mnt/demo so it survives a reboot.",
  lab: [
   "ServerA 192.0.2.10/24 — practice VM (example address)",
   "Spare disk: /dev/sdb (unpartitioned).",
   "Run every command as root."
  ],
  solutionSource: "sample",
  solutionHtml: "<pre><code class=\"lang-bash\">parted -s /dev/sdb mklabel gpt mkpart primary 1MiB 100% set 1 lvm on\npartprobe /dev/sdb\npvcreate /dev/sdb1\nvgcreate vg_demo /dev/sdb1\nlvcreate -n lv_demo -L 1G vg_demo\nmkfs.ext4 /dev/vg_demo/lv_demo\nmkdir -p /mnt/demo\nUUID=$(blkid -s UUID -o value /dev/vg_demo/lv_demo)\necho \"UUID=$UUID /mnt/demo ext4 defaults 0 0\" >> /etc/fstab\nmount -a\n\n# verify\nlvs vg_demo\ndf -h /mnt/demo</code></pre>",
  solutionText: "parted -s /dev/sdb mklabel gpt mkpart primary 1MiB 100% set 1 lvm on\npartprobe /dev/sdb\npvcreate /dev/sdb1\nvgcreate vg_demo /dev/sdb1\nlvcreate -n lv_demo -L 1G vg_demo\nmkfs.ext4 /dev/vg_demo/lv_demo\nmkdir -p /mnt/demo\nUUID=$(blkid -s UUID -o value /dev/vg_demo/lv_demo)\necho \"UUID=$UUID /mnt/demo ext4 defaults 0 0\" >> /etc/fstab\nmount -a\nlvs vg_demo\ndf -h /mnt/demo\n",
  stepCount: 6,
  guideRef: { slug: "03-local-storage", title: "Local Storage" },
  legacy: false, legacyReason: null,
  difficulty: 2, tags: ["lvm", "fstab"],
  autoGradeReady: false,
  commands: ["pvcreate", "vgcreate", "lvcreate", "mkfs", "blkid"],
  categoryLabel: "Local Storage", categoryOfficial: "Configure local storage",
  source: "sample", maxScore: 15,
  grader: { checks: [] },
  verify: [
   "`lvs` shows lv_demo at 1 GiB in vg_demo.",
   "`df -h /mnt/demo` shows it mounted as ext4.",
   "The /etc/fstab entry uses the UUID so it remounts after reboot."
  ],
  rebootCheck: "Mount by UUID in /etc/fstab so it survives a reboot; test with `mount -a` before rebooting.",
  pitfalls: [
   "A typo in /etc/fstab can stop the system from booting; always run `mount -a` to test first.",
   "Mount by UUID, not the device name, which can change."
  ]
 },
 {
  test: 0, qno: 4, id: "s4",
  category: "networking", altCategories: [],
  title: "Set a static IPv4 address with nmcli",
  prompt: "Configure the connection 'ens3' with a static address 192.0.2.50/24, gateway 192.0.2.1 and DNS 192.0.2.1, and make it apply on boot.",
  lab: [
   "ServerA — practice VM",
   "Interface: ens3 (example name).",
   "Run every command as root."
  ],
  solutionSource: "sample",
  solutionHtml: "<pre><code class=\"lang-bash\">nmcli con mod ens3 ipv4.addresses 192.0.2.50/24\nnmcli con mod ens3 ipv4.gateway 192.0.2.1\nnmcli con mod ens3 ipv4.dns 192.0.2.1\nnmcli con mod ens3 ipv4.method manual\nnmcli con mod ens3 connection.autoconnect yes\nnmcli con up ens3\n\n# verify\nnmcli -g ipv4.addresses con show ens3\nip -4 addr show ens3</code></pre>",
  solutionText: "nmcli con mod ens3 ipv4.addresses 192.0.2.50/24\nnmcli con mod ens3 ipv4.gateway 192.0.2.1\nnmcli con mod ens3 ipv4.dns 192.0.2.1\nnmcli con mod ens3 ipv4.method manual\nnmcli con mod ens3 connection.autoconnect yes\nnmcli con up ens3\nnmcli -g ipv4.addresses con show ens3\nip -4 addr show ens3\n",
  stepCount: 6,
  guideRef: { slug: "06-networking", title: "Networking" },
  legacy: false, legacyReason: null,
  difficulty: 2, tags: ["nmcli", "network"],
  autoGradeReady: false,
  commands: ["nmcli", "ip"],
  categoryLabel: "Networking", categoryOfficial: "Manage basic networking",
  source: "sample", maxScore: 12,
  grader: { checks: [] },
  verify: [
   "`ip -4 addr show ens3` reports 192.0.2.50/24.",
   "ipv4.method is 'manual' so the address is static.",
   "connection.autoconnect is yes so it applies on boot."
  ],
  rebootCheck: "autoconnect yes plus ipv4.method manual keeps the address after reboot.",
  pitfalls: [
   "Forgetting ipv4.method manual leaves the interface on DHCP.",
   "Run `nmcli con up` (or reactivate) to apply the change."
  ]
 },
 {
  test: 0, qno: 5, id: "s5",
  category: "security", altCategories: [],
  title: "Open a service in firewalld permanently",
  prompt: "Allow the 'http' service through firewalld in the default zone, both now and permanently.",
  lab: [
   "ServerA — practice VM",
   "Run every command as root."
  ],
  solutionSource: "sample",
  solutionHtml: "<pre><code class=\"lang-bash\">firewall-cmd --add-service=http --permanent\nfirewall-cmd --reload\n\n# verify\nfirewall-cmd --list-services</code></pre>",
  solutionText: "firewall-cmd --add-service=http --permanent\nfirewall-cmd --reload\nfirewall-cmd --list-services\n",
  stepCount: 2,
  guideRef: { slug: "08-security", title: "Security" },
  legacy: false, legacyReason: null,
  difficulty: 1, tags: ["firewalld"],
  autoGradeReady: false,
  commands: ["firewall-cmd"],
  categoryLabel: "Security", categoryOfficial: "Manage security",
  source: "sample", maxScore: 10,
  grader: { checks: [] },
  verify: [
   "`firewall-cmd --list-services` includes http after reload.",
   "The rule survives a reload because --permanent was used."
  ],
  rebootCheck: "--permanent writes the rule to disk so it persists across reboot.",
  pitfalls: [
   "Without --permanent the rule is lost on reload/reboot.",
   "Remember to run --reload (or also apply the runtime rule)."
  ]
 }
];
if (typeof module !== 'undefined') { module.exports = QUESTIONS; }
