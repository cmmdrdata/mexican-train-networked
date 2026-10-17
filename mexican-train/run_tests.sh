#!/usr/bin/env bash
# Run every test and write a report you can send back. The suites run in PARALLEL (several at a time); a suite that fails is run once more, alone, so a slow
# or busy machine does not give false alarms. A suite that only passes the second time is listed as "flaky" and still counts as a pass.
#
#   ./run_tests.sh                  everything: the Node suites, then the real-browser suites (if Playwright is installed)
#   ./run_tests.sh --node-only      only the Node suites (no browser needed)
#   ./run_tests.sh --browser-only   only the browser suites
#   ./run_tests.sh -j 6             run 6 suites at a time (the default is the number of CPU cores for Node suites, half of that, 2 to 4, for browser suites)
#   ./run_tests.sh --serial         one at a time (same as -j 1)
#   ./run_tests.sh --no-retry       do not run failed suites a second time
#   ./run_tests.sh four             only suites whose name contains "four" (e.g. test_four_players, test_browser_four)
#   ./run_tests.sh --list           list the suites and stop
# Needs: node (v18+; the history list wants 22.5+ for SQLite, and its tests skip themselves without), python3 (to build the page).
# For the browser suites: pip3 install playwright && python3 -m playwright install chromium
# Result: test-report-<date>/report.txt (summary + the output of every failing suite), logs/ (every suite's output) and screenshots/.
# Send me report.txt (and any screenshots you like). Exit status 0 means everything passed.

# ---- one suite (called by the runner itself, in parallel) ----
if [ "$1" = "--one" ]; then
  kind=$2; f=$3; secs=$4; tag=${5:-}
  cd "$MT_ROOT/t" || exit 2
  log="$MT_OUT/logs/$f${tag:+.$tag}.txt"; t0=$(date +%s)
  if [ "$kind" = py ]; then interp="$MT_PY -u"; else interp=node; fi
  perl -e 'alarm shift; exec @ARGV' "$secs" $interp "$f" >"$log" 2>&1; rc=$?
  took=$(( $(date +%s) - t0 ))
  summary="$(grep -E 'passed' "$log" | tail -1 | cut -c1-80)"
  [ $rc -eq 142 ] && summary="TIMED OUT after ${secs}s"
  printf '%s|%s|%s|%s\n' "$rc" "$took" "$summary" "$kind" >"$MT_OUT/results/$f${tag:+.$tag}.res"
  if [ $rc -eq 0 ]; then printf '  ok    %-40s %4ss  %s\n' "$f${tag:+ ($tag)}" "$took" "$summary"
  else printf '  FAIL  %-40s %4ss  %s (rc=%s)\n' "$f${tag:+ ($tag)}" "$took" "$summary" "$rc"; fi
  exit 0
fi

cd "$(dirname "$0")" || exit 2
ROOT="$(pwd)"
MODE=all; FILTER=""; JOBS=""; RETRY=1; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --node-only) MODE=node;; --browser-only) MODE=browser;; --serial) JOBS=1;; --no-retry) RETRY=0;; --list) LIST=1;;
    -j|--jobs) shift; JOBS="$1";; -j[0-9]*) JOBS="${1#-j}";;
    -h|--help) sed -n '2,17p' "$0"; exit 0;;
    *) FILTER="$1";;
  esac; shift
done

CORES=$( (sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2) | head -1)
case "$CORES" in ''|*[!0-9]*) CORES=2;; esac
if [ -n "$JOBS" ]; then NODE_JOBS=$JOBS; BROWSER_JOBS=$JOBS
else
  NODE_JOBS=$CORES; [ "$NODE_JOBS" -gt 8 ] && NODE_JOBS=8; [ "$NODE_JOBS" -lt 1 ] && NODE_JOBS=1
  BROWSER_JOBS=$(( CORES / 2 )); [ "$BROWSER_JOBS" -lt 2 ] && BROWSER_JOBS=2; [ "$BROWSER_JOBS" -gt 4 ] && BROWSER_JOBS=4
fi

NODE_LIST=""; PY_LIST=""
for p in t/test_*.js; do f=$(basename "$p"); [ -n "$FILTER" ] && [[ "$f" != *"$FILTER"* ]] && continue; NODE_LIST="$NODE_LIST $f"; done
for p in t/test_browser*.py; do f=$(basename "$p"); [ -n "$FILTER" ] && [[ "$f" != *"$FILTER"* ]] && continue; PY_LIST="$PY_LIST $f"; done
if [ $LIST = 1 ]; then echo "Node suites:"; for f in $NODE_LIST; do echo "  $f"; done; echo "Browser suites:"; for f in $PY_LIST; do echo "  $f"; done; exit 0; fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/test-report-$STAMP"; mkdir -p "$OUT/logs" "$OUT/results" "$OUT/screenshots"
REPORT="$OUT/report.txt"
# the tests write their screenshots to /tmp/shots: start it empty, and copy it into the report folder at the end
rm -rf /tmp/shots; mkdir -p /tmp/shots

command -v node >/dev/null || { echo "node is not installed (https://nodejs.org)"; exit 2; }
command -v perl >/dev/null || { echo "perl is needed (it is on every Mac and Linux): it is used to put a time limit on each suite"; exit 2; }
PY=python3; command -v python3 >/dev/null || PY=""
HAVE_PW=0; [ -n "$PY" ] && $PY -c "import playwright" 2>/dev/null && HAVE_PW=1

# every file the suites read must be here (a zip that lost one would fail in confusing ways)
MISSING=""
for need in game.js style.css template.html build.py server.js online-match.js history.js gamelog.js ws-lite.js game_v4_rule.js tools/check_gamelog.js t/browser_server.js t/connection_server.js; do [ -e "$need" ] || MISSING="$MISSING $need"; done
[ -n "$MISSING" ] && { echo "files the tests need are missing:$MISSING"; exit 2; }

# build the page and give the tests their copy of game.js
if [ -n "$PY" ]; then $PY build.py >"$OUT/logs/build.txt" 2>&1 || { echo "build failed, see $OUT/logs/build.txt"; exit 2; }; else echo "python3 not found: the page is not rebuilt (the tests use the mexican-train.html that is here)"; fi
cp game.js t/game.js

T0=$(date +%s)
{
  echo "Mexican Train test report, $(date)"
  echo "machine: $(uname -srm), $CORES cores, node $(node -v), $([ -n "$PY" ] && $PY -V 2>&1)"
  echo "build: $(grep -o 'MT_BUILD = "[0-9a-f]*"' mexican-train.html | head -1)"
  echo "mode: $MODE${FILTER:+, filter: $FILTER}; parallel: $NODE_JOBS Node suites and $BROWSER_JOBS browser suites at a time; retry of failures: $([ $RETRY = 1 ] && echo yes || echo no)"
  echo "browser suites: $([ $HAVE_PW = 1 ] && echo available || echo 'NOT available (Playwright not installed)')"
  echo
} >"$REPORT"

export MT_ROOT="$ROOT" MT_OUT="$OUT" MT_PY="$PY"
SELF="$ROOT/run_tests.sh"
run_batch() {                          # $1 = kind (js|py)  $2 = jobs  $3 = list of files
  local kind=$1 jobs=$2; shift 2
  [ $# -eq 0 ] && return
  printf '%s\n' "$@" | xargs -P "$jobs" -I{} bash "$SELF" --one "$kind" {} 900
}

if [ "$MODE" != browser ] && [ -n "$NODE_LIST" ]; then
  echo "Node suites (${NODE_JOBS} at a time):"
  run_batch js "$NODE_JOBS" $NODE_LIST
fi
SKIP=0
if [ "$MODE" != node ] && [ -n "$PY_LIST" ]; then
  if [ $HAVE_PW = 1 ]; then
    echo "Browser suites (${BROWSER_JOBS} at a time):"
    run_batch py "$BROWSER_JOBS" $PY_LIST
  else SKIP=1; echo "browser suites skipped: pip3 install playwright && python3 -m playwright install chromium"; fi
fi

# whatever failed gets one more go, alone on the machine
FAILED_FIRST=""
for res in "$OUT"/results/*.res; do
  [ -e "$res" ] || continue
  f=$(basename "$res" .res); IFS='|' read -r rc took summary kind <"$res"
  [ "$rc" != 0 ] && FAILED_FIRST="$FAILED_FIRST $f|$kind"
done
FLAKY=""; FAILED=""
if [ -n "$FAILED_FIRST" ] && [ $RETRY = 1 ]; then
  echo; echo "Running the failed suites again, one at a time:"
  for fk in $FAILED_FIRST; do
    f=${fk%|*}; kind=${fk#*|}
    bash "$SELF" --one "$kind" "$f" 900 retry
    IFS='|' read -r rc took summary k <"$OUT/results/$f.retry.res"
    if [ "$rc" = 0 ]; then FLAKY="$FLAKY $f"; else FAILED="$FAILED $f"; fi
  done
else
  for fk in $FAILED_FIRST; do FAILED="$FAILED ${fk%|*}"; done
fi

# the report
TOTAL=$(ls "$OUT"/results/*.res 2>/dev/null | grep -vc '\.retry\.res$')
{
  for res in "$OUT"/results/*.res; do
    [ -e "$res" ] || continue
    f=$(basename "$res" .res); case "$f" in *.retry) continue;; esac
    IFS='|' read -r rc took summary kind <"$res"
    case " $FAILED " in *" $f "*) printf 'FAIL  %-40s %4ss  rc=%s  %s\n' "$f" "$took" "$rc" "$summary";; *)
      case " $FLAKY " in *" $f "*) printf 'flaky %-40s %4ss  failed once (rc=%s), then passed alone\n' "$f" "$took" "$rc";; *) printf 'ok    %-40s %4ss  %s\n' "$f" "$took" "$summary";; esac;; esac
  done
} | sort >>"$REPORT"
FAILN=$(echo $FAILED | wc -w | tr -d ' '); FLAKYN=$(echo $FLAKY | wc -w | tr -d ' '); PASS=$((TOTAL-FAILN))
cp /tmp/shots/* "$OUT/screenshots/" 2>/dev/null
ELAPSED=$(( $(date +%s) - T0 ))
{
  echo; echo "=== $PASS of $TOTAL suites passed, $FAILN failed$([ "$FLAKYN" -gt 0 ] && echo ", $FLAKYN flaky (passed on the second run)")$([ "$SKIP" = 1 ] && echo ' (browser suites skipped: Playwright is not installed)'); $((ELAPSED/60)) min $((ELAPSED%60)) s ==="
  if [ $FAILN -gt 0 ]; then
    echo "Failed:$FAILED"; echo
    for f in $FAILED; do echo "----- $f (last 60 lines of the first run) -----"; tail -60 "$OUT/logs/$f.txt"; echo; [ -e "$OUT/logs/$f.retry.txt" ] && { echo "----- $f (last 30 lines of the second run) -----"; tail -30 "$OUT/logs/$f.retry.txt"; echo; }; done
  fi
  if [ $FLAKYN -gt 0 ]; then echo "Flaky (failed when run alongside others, passed alone):$FLAKY"; fi
} >>"$REPORT"
echo; tail -n +9 "$REPORT" | sed -n '/^===/,$p' | head -3
echo "Report: $REPORT"
[ $FAILN -eq 0 ]
