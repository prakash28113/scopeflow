#!/usr/bin/env bash
# Full end-to-end run on Cloudflare's runtime (workerd) against a local Supabase stand-in.
# Requires: POSTGREST_BIN (PostgREST v12 binary), optional CHROME_PATH.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOGS="$HERE/.logs"; mkdir -p "$LOGS"
cleanup() { [[ -n "${STACK_PID:-}" ]] && kill "$STACK_PID" 2>/dev/null || true; [[ -n "${WRANGLER_PID:-}" ]] && kill "$WRANGLER_PID" 2>/dev/null || true; }
trap cleanup EXIT

node "$HERE/stack.mjs" > "$LOGS/stack.log" 2>&1 & STACK_PID=$!
for _ in $(seq 1 40); do grep -q "Schema cache loaded in" "$LOGS/stack.log" 2>/dev/null && break; sleep 0.5; done
ANON=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$HERE/keys.json')).anon)")

cd "$ROOT"
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY="$ANON" npx vite build --logLevel warn
NO_PROXY=127.0.0.1,localhost WRANGLER_SEND_METRICS=false npx wrangler dev --port 3000 --ip 127.0.0.1 \
  --var SUPABASE_URL:http://127.0.0.1:54321 --var "SUPABASE_ANON_KEY:$ANON" > "$LOGS/wrangler.log" 2>&1 & WRANGLER_PID=$!
for _ in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:3000/ && break; sleep 0.5; done

BASE=http://localhost:3000 node "$HERE/workflow.mjs"
