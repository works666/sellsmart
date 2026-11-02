#!/bin/bash
set -Eeuo pipefail

APP_WORKSPACE_PATH="${APP_WORKSPACE_PATH:-$(pwd)}"
cd "${APP_WORKSPACE_PATH}"

if [[ -x "${APP_WORKSPACE_PATH}/node_modules/.bin/tsc" && -x "${APP_WORKSPACE_PATH}/node_modules/.bin/eslint" ]]; then
  "${APP_WORKSPACE_PATH}/node_modules/.bin/tsc" -p tsconfig.json
  "${APP_WORKSPACE_PATH}/node_modules/.bin/eslint" . --quiet
else
  echo "Validation dependencies are missing. Run: corepack pnpm install --frozen-lockfile" >&2
  exit 1
fi
