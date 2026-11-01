#!/usr/bin/env bash
# Full end-to-end run on Cloudflare's runtime (workerd) against a local Supabase stand-in.
# Requires: POSTGREST_BIN (PostgREST v12 binary), optional CHROME_PATH.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOGS="$HERE/.logs"; mkdir -p "$LOGS"
cleanup() {
  status=$?
  if [[ $status -ne 0 ]]; then
    echo "----- stack.log (tail) -----"; tail -n 60 "$LOGS/stack.log" 2>/dev/null || true
    echo "----- wrangler.log (tail) -----"; tail -n 40 "$LOGS/wrangler.log" 2>/dev/null || true
  fi
  # Stop the stand-in's children (PostgREST) too, so a failed run never leaves ports busy.
  [[ -n "${STACK_PID:-}" ]] && { pkill -P "$STACK_PID" 2>/dev/null; kill "$STACK_PID" 2>/dev/null; } || true
  [[ -n "${WRANGLER_PID:-}" ]] && kill "$WRANGLER_PID" 2>/dev/null || true
}
trap cleanup EXIT

node "$HERE/stack.mjs" > "$LOGS/stack.log" 2>&1 & STACK_PID=$!
ready=""
for _ in $(seq 1 120); do
  if grep -q "Schema cache loaded in" "$LOGS/stack.log" 2>/dev/null && curl -s -o /dev/null http://127.0.0.1:54321/; then ready=1; break; fi
  sleep 0.5
done
[[ -n "$ready" ]] || { echo "Local Supabase stand-in did not start"; exit 1; }
ANON=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$HERE/keys.json')).anon)")

cd "$ROOT"
# A test Google client ID turns the "Continue with Google" button on; the walkthrough stubs Google's script.
VITE_GOOGLE_CLIENT_ID=1234567890-scopeflowtest.apps.googleusercontent.com VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY="$ANON" npx vite build --logLevel warn
NO_PROXY=127.0.0.1,localhost WRANGLER_SEND_METRICS=false npx wrangler dev --port 3000 --ip 127.0.0.1 \
  --var SUPABASE_URL:http://127.0.0.1:54321 --var "SUPABASE_ANON_KEY:$ANON" --var GOOGLE_SIGNIN_ENABLED:true > "$LOGS/wrangler.log" 2>&1 & WRANGLER_PID=$!
for _ in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:3000/ && break; sleep 0.5; done

BASE=http://localhost:3000 node "$HERE/workflow.mjs"
