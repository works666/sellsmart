#!/bin/bash
set -Eeuo pipefail

APP_WORKSPACE_PATH="${APP_WORKSPACE_PATH:-$(pwd)}"
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-5000}"

cd "${APP_WORKSPACE_PATH}"
echo "Starting production server on port ${DEPLOY_RUN_PORT}..."
PORT=${DEPLOY_RUN_PORT} node dist/server.js
