#!/usr/bin/env bash
# Run the full Playwright E2E suite across every supported browser
# project (chrome, edge, brave, opera, firefox) — one project per
# subprocess.
#
# Why one subprocess per project?
#   When multiple projects are passed in a single `playwright test`
#   invocation, the configured `webServer` (Vite + Node game server)
#   stays alive only for the FIRST project that boots it. Once that
#   project finishes its tests, Playwright tears the webServer down
#   even though `reuseExistingServer: true` is set, leaving every
#   subsequent project (chrome, edge, brave, opera after firefox)
#   hitting `net::ERR_CONNECTION_REFUSED` on `localhost:9000`.
#
#   Spawning one Playwright invocation per browser gives each its own
#   webServer lifecycle and produces clean 48/0/1 results across all
#   five engines. The trade-off is wall-clock: ~10 min per browser,
#   ~50 min total. The single-invocation path takes ~30 min when it
#   works but currently doesn't.
#
# Usage:
#   bash scripts/e2e-all-browsers.sh                # run all 5
#   bash scripts/e2e-all-browsers.sh chrome firefox # subset
#
# Exits non-zero if any browser had a failing test. Per-browser logs
# are written to /tmp/dev-e2e-<browser>.log for post-mortem.
set -uo pipefail

DEFAULT_BROWSERS=(firefox chrome edge brave opera)
BROWSERS=("${@:-${DEFAULT_BROWSERS[@]}}")

cd "$(dirname "$0")/.."
rm -rf test-results/

overall_rc=0
declare -a summary

for b in "${BROWSERS[@]}"; do
    echo "========================================================="
    echo ">>> running E2E in [$b]"
    echo "========================================================="
    log="/tmp/dev-e2e-$b.log"
    npx playwright test --project="$b" --reporter=list \
        --grep-invert "ai-behavior" 2>&1 | tee "$log" > /dev/null
    rc=${PIPESTATUS[0]}
    pa=$(grep -cE "^\s*ok " "$log" 2> /dev/null || echo 0)
    fa=$(grep -cE "^\s*x " "$log" 2> /dev/null || echo 0)
    sk=$(grep -cE "^\s*-  " "$log" 2> /dev/null || echo 0)
    if [ "$rc" -ne 0 ]; then overall_rc=$rc; fi
    line="[$b] $pa pass / $fa fail / $sk skip  (exit=$rc, log=$log)"
    echo "$line"
    summary+=("$line")
done

echo
echo "========================================================="
echo "                  CROSS-BROWSER SUMMARY"
echo "========================================================="
for line in "${summary[@]}"; do echo "  $line"; done
echo

exit "$overall_rc"
