#!/usr/bin/env bash
# Veena deploy script — one shot to safely push API + client.
#
# Usage:  ./deploy.sh
#
# What it does:
#   1. Builds the client with the Catalyst-correct PUBLIC_URL + 404 fallback
#   2. Verifies the build artefacts that Catalyst needs are actually present
#      (catches the most common "deploy succeeded but site 404s" failure mode)
#   3. Runs `catalyst deploy`
#
# Any step failing aborts the run — no partial deploys.

set -euo pipefail

# Always work from the repo root (the script's own directory).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------- helpers ----------
red()    { printf "\033[31m%s\033[0m\n" "$1"; }
green()  { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
blue()   { printf "\033[34m%s\033[0m\n" "$1"; }

fail() { red "✖ $1"; exit 1; }

# ---------- pre-flight ----------
blue "▶ Veena deploy"
echo "  working dir: $SCRIPT_DIR"

command -v catalyst >/dev/null 2>&1 || fail "catalyst CLI not found. Install with: npm i -g zcatalyst-cli"
command -v npm      >/dev/null 2>&1 || fail "npm not found. Install Node.js (v18+ recommended)."
[ -f "catalyst.json" ] || fail "catalyst.json missing — are you in the repo root?"
[ -d "client" ]        || fail "client/ directory missing."
[ -d "functions/api" ] || fail "functions/api/ missing."

# CRON_SECRET reminder — easy to forget in fresh checkouts.
if ! grep -q '"CRON_SECRET"' functions/api/catalyst-config.json 2>/dev/null; then
  yellow "⚠ CRON_SECRET not set in functions/api/catalyst-config.json"
  yellow "  The monthly fee-reminder cron will return 503 without it."
  yellow "  Add: env_variables.CRON_SECRET = <long random string>"
  echo
fi

# ---------- generate configs from master ----------
# Expand config.master.js into the backend / client / landing configs so the
# shipped values always match the single source of truth. (The client build
# also runs this via prebuild, but we do it here too in case the backend is
# ever deployed without a client build.)
blue "▶ Generating configs (config.master.js → per-runtime files)"
node scripts/gen-config.js

# ---------- client build ----------
blue "▶ Building client (npm run build)"
( cd client && npm run build )

# ---------- verify build artefacts ----------
blue "▶ Verifying build artefacts"
DIST="client/dist"
[ -f "$DIST/index.html"           ] || fail "$DIST/index.html missing after build"
[ -f "$DIST/404.html"             ] || fail "$DIST/404.html missing — SPA routes will 404. Did you run the right script?"
[ -f "$DIST/client-package.json"  ] || fail "$DIST/client-package.json missing — Catalyst deploy will skip the client."

# Make sure the script tag in index.html actually points at /app/* (the build
# default with PUBLIC_URL unset will produce '/main.js' which 404s under
# Catalyst's /app/ mount). This caught us once already.
if ! grep -q 'src="/app/' "$DIST/index.html"; then
  fail "index.html does not reference /app/ assets. PUBLIC_URL=/app/ was probably not set during build."
fi
green "  ✓ artefacts look correct"

# ---------- stamp build version ----------
# Write the git SHA + build time into the function so /api/health can report
# exactly which commit is live. Lets you verify a deploy with a single curl.
blue "▶ Stamping build version"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY=""
git diff --quiet 2>/dev/null || GIT_DIRTY="-dirty"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{\n  "commit": "%s%s",\n  "builtAt": "%s"\n}\n' "$GIT_SHA" "$GIT_DIRTY" "$BUILT_AT" \
  > functions/api/version.json
green "  ✓ commit ${GIT_SHA}${GIT_DIRTY} @ ${BUILT_AT}"

# ---------- deploy ----------
blue "▶ Running catalyst deploy"
catalyst deploy

green "✔ Deploy complete."
echo
echo "Quick smoke test (the 'commit' field should read ${GIT_SHA}${GIT_DIRTY}):"
echo "  curl -s 'https://veena-attendance-60070745325.development.catalystserverless.in/server/api/api/health'"
