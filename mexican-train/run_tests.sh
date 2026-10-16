#!/usr/bin/env bash
# Run every test, one at a time, and write a report you can send back.
#   ./run_tests.sh               everything (Node suites, then the real-browser suites if Playwright is installed)
#   ./run_tests.sh --node-only   only the Node suites (no browser needed)
#   ./run_tests.sh --browser-only
#   ./run_tests.sh four          only suites whose name contains "four" (e.g. test_four_players, test_browser_four)
# Needs: node (v18+), python3. For the browser suites: pip3 install playwright && python3 -m playwright install chromium
# Result: test-report-<date>/report.txt (summary + the output of every failing suite) and test-report-<date>/screenshots/.
# Send me report.txt (and any screenshots you like). Exit status 0 means everything passed.
cd "$(dirname "$0")" || exit 2
ROOT="$(pwd)"
MODE=all; FILTER=""
for a in "$@"; do case "$a" in --node-only) MODE=node;; --browser-only) MODE=browser;; *) FILTER="$a";; esac; done
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/test-report-$STAMP"; mkdir -p "$OUT/logs" "$OUT/screenshots"
REPORT="$OUT/report.txt"
# the tests write their screenshots to /tmp/shots: start it empty, and copy it into the report folder at the end
rm -rf /tmp/shots; mkdir -p /tmp/shots

command -v node >/dev/null || { echo "node is not installed (https://nodejs.org)"; exit 2; }
PY=python3; command -v python3 >/dev/null || PY=""
HAVE_PW=0; [ -n "$PY" ] && $PY -c "import playwright" 2>/dev/null && HAVE_PW=1

# build the page and give the tests their copy of game.js
if [ -n "$PY" ]; then $PY build.py >"$OUT/logs/build.txt" 2>&1 || { echo "build failed, see $OUT/logs/build.txt"; exit 2; }; fi
cp game.js t/game.js

# run a command with a time limit (macOS has no `timeout`; perl is on every Mac and Linux)
limit() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

{
  echo "Mexican Train test report, $(date)"
  echo "machine: $(uname -srm), node $(node -v), $([ -n "$PY" ] && $PY -V 2>&1)"
  echo "build: $(grep -o 'MT_BUILD = "[0-9a-f]*"' mexican-train.html | head -1)"
  echo "mode: $MODE${FILTER:+, filter: $FILTER}; browser suites: $([ $HAVE_PW = 1 ] && echo available || echo 'NOT available (Playwright not installed)')"
  echo
} >"$REPORT"

PASS=0; FAILN=0; SKIP=0; FAILED=""
run_suite() {                         # $1 = file, $2 = interpreter, $3 = seconds allowed
  local f=$1 interp=$2 secs=$3 log="$OUT/logs/$1.txt" t0=$(date +%s) rc
  printf '%-38s ' "$f"
  (cd "$ROOT/t" && limit "$secs" $interp "$f") >"$log" 2>&1; rc=$?
  local took=$(( $(date +%s) - t0 )) summary; summary="$(grep -E 'passed' "$log" | tail -1 | cut -c1-80)"
  if [ $rc -eq 0 ]; then PASS=$((PASS+1)); echo "ok    ${took}s  $summary"; echo "ok    $f  ${took}s  $summary" >>"$REPORT"
  else FAILN=$((FAILN+1)); FAILED="$FAILED $f"; [ $rc -eq 142 ] && summary="TIMED OUT after ${secs}s"; echo "FAIL  ${took}s  $summary (rc=$rc)"; echo "FAIL  $f  ${took}s  rc=$rc  $summary" >>"$REPORT"; fi
}

if [ "$MODE" != browser ]; then
  for p in t/test_*.js; do f=$(basename "$p"); [ -n "$FILTER" ] && [[ "$f" != *"$FILTER"* ]] && continue; run_suite "$f" node 900; done
fi
if [ "$MODE" != node ]; then
  if [ $HAVE_PW = 1 ]; then
    for p in t/test_browser*.py; do f=$(basename "$p"); [ -n "$FILTER" ] && [[ "$f" != *"$FILTER"* ]] && continue; run_suite "$f" "$PY -u" 900; done
  else SKIP=1; echo "browser suites skipped: pip3 install playwright && python3 -m playwright install chromium"; fi
fi

cp /tmp/shots/* "$OUT/screenshots/" 2>/dev/null
{
  echo; echo "=== $PASS suites passed, $FAILN failed${SKIP:+ (browser suites skipped: $SKIP)} ==="
  if [ $FAILN -gt 0 ]; then
    echo "Failed:$FAILED"; echo
    for f in $FAILED; do echo "----- $f (last 60 lines) -----"; tail -60 "$OUT/logs/$f.txt"; echo; done
  fi
} >>"$REPORT"
echo; echo "Passed: $PASS   Failed: $FAILN${FAILED:+  ($FAILED )}"; echo "Report: $REPORT"
[ $FAILN -eq 0 ]
