#!/usr/bin/env bash
# After a deploy: does the app answer as it should? Read-only: it signs nobody
# up and writes nothing, so it may run against the live app (unlike `pnpm check`).
# A stream opened signed out is not counted among the people here.
#
#   scripts/smoke.sh [base url]      (default: the live app)
set -uo pipefail
base=${1:-https://comp4020-final-1181278174.fly.dev}
failed=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; failed=1; }

# the first request after a quiet spell starts the machine, which takes a few seconds
curl -s -o /dev/null --max-time 30 "$base/" || true

status() { curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$base$1"; }
for path in / /help /privacy /signin /signup /readme/ /s/HAND /s/HAND/questions /s/HAND/timeline /s/HAND/present; do
  code=$(status "$path")
  [ "$code" = 200 ] && ok "$path answers 200" || bad "$path answers $code"
done
code=$(status /no-such-page)
[ "$code" = 404 ] && ok "a wrong address answers 404" || bad "a wrong address answers $code"

headers=$(curl -s -o /dev/null -D - --max-time 15 "$base/")
grep -qi '^x-frame-options: DENY' <<< "$headers" && ok "pages can't be framed" || bad "x-frame-options is missing"
grep -qi '^strict-transport-security:' <<< "$headers" && ok "HTTPS only" || bad "strict-transport-security is missing"

# the live stream sends the room's state at once
# (the stream first says which sign-in it is for, "data: -" here; the state is the first JSON line)
first=$(curl -s -N --max-time 5 "$base/s/HAND/events" | grep -m1 '^data: {')
grep -q '"here":' <<< "$first" && ok "the live stream sends the room's state" || bad "the live stream sent nothing"

[ "$failed" = 0 ] && echo "all fine" || echo "something is wrong: read the logs (docs/operations.md)"
exit "$failed"
