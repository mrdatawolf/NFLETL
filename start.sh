#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
npm install --no-audit --no-fund
npm run build
node dist/run.js "$@"
