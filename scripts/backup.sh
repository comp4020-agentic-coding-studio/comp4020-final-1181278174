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
umask 077
cd "$(dirname "$0")/.."
app=comp4020-final-1181278174
repo=$(pwd -P)
dir=$(realpath -m "${1:-"$HOME/hands-up-backups"}")
case "$dir/" in
  "$repo"/*) echo "refusing to write a backup inside the repo: $dir" >&2; exit 1 ;;
esac
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="hands-up-$stamp.db"
remote_db="/tmp/hands-up-$stamp.db"
remote_js="/tmp/hands-up-backup-$stamp.cjs"
work=$(mktemp -d)
mkdir -p "$dir"
partial="$dir/.partial-$name"

# Whatever happens, nothing is left behind: not on the machine, not half a copy here.
cleanup() {
  rm -f "$partial"
  rm -r "$work"
  if ! flyctl ssh console -a "$app" -C "rm -f $remote_db $remote_js" > /dev/null 2>&1; then
    echo "could not remove $remote_db or $remote_js on the machine; remove them by hand" >&2
  fi
}
trap cleanup EXIT

cat > "$work/backup.cjs" <<'JS'
// on the machine: a consistent copy of the live database
const Database = require("/app/node_modules/better-sqlite3");
const db = new Database("/data/hands-up.db", { readonly: true });
db.backup(process.argv[2]).then(
  () => console.log("copied on the machine"),
  (error) => { console.error(error.message); process.exit(1); },
);
JS

# SSH doesn't start a stopped machine, but a page request does; the first
# connection after that can still be refused, so try three times.
curl -s -o /dev/null --max-time 30 "https://$app.fly.dev/" || true
for try in 1 2 3; do
  if flyctl ssh sftp put "$work/backup.cjs" "$remote_js" -a "$app" > /dev/null; then break; fi
  [ "$try" = 3 ] && exit 1
  sleep 5
done
flyctl ssh console -a "$app" -C "node $remote_js $remote_db"
flyctl ssh sftp get "$remote_db" "$partial" -a "$app" > /dev/null

# The copy becomes one self-contained file (no -wal or -shm beside it), then
# SQLite's own check of it, then how much it holds; only then does it get its name.
node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1]);
db.pragma("journal_mode = DELETE");
const check = db.pragma("integrity_check", { simple: true });
if (check !== "ok") { console.error("integrity check failed:", check); process.exit(1); }
const n = (table) => db.prepare(`select count(*) n from ${table}`).get().n;
console.log(`checked: ${n("sessions")} sessions, ${n("questions")} questions, ${n("accounts")} accounts`);
db.close();
' "$partial"
mv "$partial" "$dir/$name"
echo "$dir/$name"
