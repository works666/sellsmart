#!/bin/bash
set -Eeuo pipefail

APP_WORKSPACE_PATH="${APP_WORKSPACE_PATH:-$(pwd)}"
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-5000}"

cd "${APP_WORKSPACE_PATH}"
echo "Starting development server on port ${DEPLOY_RUN_PORT}..."

LOCAL_TSX="${APP_WORKSPACE_PATH}/node_modules/.bin/tsx"
if [[ -x "${LOCAL_TSX}" ]]; then
  PORT=${DEPLOY_RUN_PORT} "${LOCAL_TSX}" watch src/server.ts
elif command -v corepack >/dev/null 2>&1; then
  echo "Local tsx was not found; using the project's Corepack pnpm version."
  PORT=${DEPLOY_RUN_PORT} corepack pnpm run dev
else
  echo "Local tsx was not found and Corepack is unavailable. Run: corepack pnpm install --frozen-lockfile" >&2
  exit 1
fi
