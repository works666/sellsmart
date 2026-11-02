#!/bin/bash
set -Eeuo pipefail

APP_WORKSPACE_PATH="${APP_WORKSPACE_PATH:-$(pwd)}"
cd "${APP_WORKSPACE_PATH}"

if [[ ! -x "${APP_WORKSPACE_PATH}/node_modules/.bin/next" || ! -x "${APP_WORKSPACE_PATH}/node_modules/.bin/tsup" ]]; then
  if ! command -v corepack >/dev/null 2>&1; then
    echo "Build dependencies are missing and Corepack is unavailable. Run: corepack pnpm install --frozen-lockfile" >&2
    exit 1
  fi
  corepack pnpm install --frozen-lockfile
fi

"${APP_WORKSPACE_PATH}/node_modules/.bin/next" build
"${APP_WORKSPACE_PATH}/node_modules/.bin/tsup" src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify
