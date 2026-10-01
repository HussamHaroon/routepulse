#!/usr/bin/env bash
# ============================================================
# Routepulse one-command dev startup
# Starts: API (:8787) -> waits for health -> App (:5173) + Simulator
# Logs:   /tmp/routepulse-{api,app,sim}.log
# Stop:   Ctrl+C kills all three.
# Usage:  bash dev.sh
# ============================================================
set -u
cd "$(dirname "$0")"

API_LOG="/tmp/routepulse-api.log"
APP_LOG="/tmp/routepulse-app.log"
SIM_LOG="/tmp/routepulse-sim.log"
HEALTH_URL="http://localhost:8787/api/health"
APP_URL="http://localhost:5173"

API_PID="" APP_PID="" SIM_PID=""

log()  { printf '\033[1;36m[routepulse]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[routepulse]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[routepulse]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  log "shutting down (api, app, simulator)..."
  for pid in "$SIM_PID" "$APP_PID" "$API_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  sleep 1
  for pid in "$SIM_PID" "$APP_PID" "$API_PID"; do
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  log "all stopped."
}
trap cleanup EXIT INT TERM

# --- 0. tooling present? ------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node >= 20 (https://nodejs.org)."
command -v curl >/dev/null 2>&1 || die "curl not found (needed for the API health check)."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || warn "Node $(node -v) detected; Routepulse targets Node >= 20 — things may break."

# --- 1. dependencies installed? ------------------------------
MISSING=""
if [ ! -d node_modules ] && [ ! -d api/node_modules ]; then
  MISSING="${MISSING}
  - repo root            (npm install)   # installs api + simulator deps"
fi
if [ ! -d app/node_modules ]; then
  MISSING="${MISSING}
  - app/                 (cd app && npm install)"
fi
if [ -n "$MISSING" ]; then
  die "Missing node_modules — run npm install in each:${MISSING}"
fi

# --- 2. ports already busy? ----------------------------------
if curl -s --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  die "Something is already serving on :8787 (health responds). Kill the old process first (see RUNBOOK.md section 7)."
fi
if curl -s --max-time 1 "$APP_URL" >/dev/null 2>&1; then
  die "Something is already serving on :5173. Kill it first (see RUNBOOK.md section 7)."
fi

# --- 3. start API --------------------------------------------
log "starting API on :8787 (log: $API_LOG)"
node api/server.js >"$API_LOG" 2>&1 &
API_PID=$!

# --- 4. wait for health --------------------------------------
log "waiting for health at $HEALTH_URL ..."
HEALTHY=""
for _ in $(seq 1 60); do
  if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "---------- api log tail ----------"
    tail -n 30 "$API_LOG"
    die "API exited during startup (full log: $API_LOG)."
  fi
  sleep 1
done
if [ -z "$HEALTHY" ]; then
  echo "---------- api log tail ----------"
  tail -n 30 "$API_LOG"
  die "API did not become healthy within 60s (log: $API_LOG)."
fi
log "API is healthy."

# --- 5. start App (Vite) --------------------------------------
log "starting app on :5173 (log: $APP_LOG)"
(cd app && exec node node_modules/vite/bin/vite.js --strictPort) >"$APP_LOG" 2>&1 &
APP_PID=$!
sleep 3
kill -0 "$APP_PID" 2>/dev/null || {
  echo "---------- app log tail ----------"
  tail -n 30 "$APP_LOG"
  die "App exited during startup (full log: $APP_LOG)."
}

# --- 6. start Simulator ---------------------------------------
log "starting GPS simulator (log: $SIM_LOG)"
node simulator/sim.js >"$SIM_LOG" 2>&1 &
SIM_PID=$!
sleep 2
kill -0 "$SIM_PID" 2>/dev/null || warn "Simulator exited early — check $SIM_LOG (buses will not move)."

# --- 7. ready ---------------------------------------------------
echo ""
log "=============================================="
log "  Routepulse is up."
log "    App:       $APP_URL"
log "    API:       http://localhost:8787"
log "    Health:    $HEALTH_URL"
log "    Logs:      $API_LOG / $APP_LOG / $SIM_LOG"
log "  Press Ctrl+C to stop everything."
log "=============================================="
echo ""

wait
