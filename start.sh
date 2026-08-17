#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
npm install --no-audit --no-fund

# npm install can retain a native addon built by a different Node version
# when node_modules survives an upgrade or is copied from another machine.
if ! node -e "const Database = require('better-sqlite3'); new Database(':memory:').close()" >/dev/null 2>&1; then
  echo "Rebuilding better-sqlite3 for Node $(node --version)..."
  npm rebuild better-sqlite3
fi

npm run build
node dist/run.js "$@"
