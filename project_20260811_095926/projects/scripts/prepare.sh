#!/bin/bash
set -Eeuo pipefail

APP_WORKSPACE_PATH="${APP_WORKSPACE_PATH:-$(pwd)}"
cd "${APP_WORKSPACE_PATH}"

if [[ ! -x "${APP_WORKSPACE_PATH}/node_modules/.bin/tsx" ]]; then
  if ! command -v corepack >/dev/null 2>&1; then
    echo "Project dependencies are missing and Corepack is unavailable. Run: corepack pnpm install --frozen-lockfile" >&2
    exit 1
  fi
  corepack pnpm install --frozen-lockfile
else
  echo "Using the existing local dependencies; skipping package installation."
fi
