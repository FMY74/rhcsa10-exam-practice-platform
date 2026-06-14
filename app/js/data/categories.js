// Category list for the public demo. The names are the public RHCSA/RHEL 10
// exam objectives published by Red Hat. Only the five categories used by the
// original sample task set are listed here.
const CATEGORIES = [
 { slug: "essential-tools", official: "Understand and use essential tools", label: "Essential Tools", guide: "01-essential-tools" },
 { slug: "local-storage",   official: "Configure local storage",            label: "Local Storage",   guide: "03-local-storage" },
 { slug: "networking",      official: "Manage basic networking",            label: "Networking",      guide: "06-networking" },
 { slug: "users-groups",    official: "Manage users and groups",            label: "Users & Groups",  guide: "07-users-groups" },
 { slug: "security",        official: "Manage security",                    label: "Security",        guide: "08-security" }
];
if (typeof module !== 'undefined') { module.exports = CATEGORIES; }
