#!/bin/sh
# Dev runner: type-check in watch mode, run the server with auto-restart, and
# make a single Ctrl+C tear everything down (tsc watcher + dev containers).
#
# Do NOT `exec` the node process here. The trap below is what brings the
# containers down, so this shell has to stay alive for the whole session.

set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

TSC_PID=""
CONTAINERS_UP=0

cleanup() {
  # Clear the traps so a second Ctrl+C cannot re-enter this function.
  trap - EXIT INT TERM

  if [ -n "$TSC_PID" ]; then
    kill "$TSC_PID" 2>/dev/null || true
  fi

  if [ "$CONTAINERS_UP" = "1" ]; then
    echo ""
    echo "[dev] shutting down containers..."
    podman-compose down || true
  fi
}

trap cleanup EXIT INT TERM

podman-compose up -d || exit 1
CONTAINERS_UP=1

./node_modules/typescript/bin/tsc -w &
TSC_PID=$!

# A fixed secret in dev keeps JWTs valid across restarts, so a token captured
# once can be reused for scripted testing (e.g. Chrome DevTools MCP).
# SECRET from the environment still wins. Never used in production.
SECRET=${SECRET:-dev_secret_for_local_testing}
export SECRET

IS_DEV=true node --watch --watch-path=build --watch-preserve-output build/index.js
