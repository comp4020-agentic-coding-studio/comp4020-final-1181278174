#!/usr/bin/env bash
# Copy the live database to this computer, consistent and checked.
#
#   mise exec -- scripts/backup.sh [directory]
#
# The copy is made on the machine with SQLite's online backup, so it includes
# what is still in the write-ahead log; copying hands-up.db by itself can miss
# the newest changes. The copy holds accounts, hands and votes: keep it
# private and out of this repo. The default directory is ~/hands-up-backups.
# Never run the app on a backup itself; copy it first (docs/operations.md).
set -euo pipefail
cd "$(dirname "$0")/.."
app=comp4020-final-1181278174
dir=${1:-"$HOME/hands-up-backups"}
name="hands-up-$(date -u +%Y%m%dT%H%M%SZ).db"
work=$(mktemp -d)
trap 'rm -r "$work"' EXIT
mkdir -p "$dir"
chmod 700 "$dir"

cat > "$work/backup.cjs" <<'JS'
// on the machine: a consistent copy of the live database
const Database = require("/app/node_modules/better-sqlite3");
const db = new Database("/data/hands-up.db", { readonly: true });
db.backup(process.argv[2]).then(
  () => console.log("copied on the machine"),
  (error) => { console.error(error.message); process.exit(1); },
);
JS
flyctl ssh sftp put "$work/backup.cjs" /tmp/hands-up-backup.cjs -a "$app" > /dev/null
flyctl ssh console -a "$app" -C "node /tmp/hands-up-backup.cjs /tmp/$name"
flyctl ssh sftp get "/tmp/$name" "$dir/$name" -a "$app" > /dev/null
flyctl ssh console -a "$app" -C "rm /tmp/$name /tmp/hands-up-backup.cjs" > /dev/null
chmod 600 "$dir/$name"

# The copy becomes one self-contained file (no -wal or -shm beside it), then
# SQLite's own check of it, then how much it holds.
node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1]);
db.pragma("journal_mode = DELETE");
const check = db.pragma("integrity_check", { simple: true });
if (check !== "ok") { console.error("integrity check failed:", check); process.exit(1); }
const n = (table) => db.prepare(`select count(*) n from ${table}`).get().n;
console.log(`checked: ${n("sessions")} sessions, ${n("questions")} questions, ${n("accounts")} accounts`);
db.close();
' "$dir/$name"
echo "$dir/$name"
