#!/usr/bin/env bash
# Lint, test, package and upload+publish a new version to the Chrome Web Store.
# Needs a .env file (see .env.example). Remember to bump "version" in
# extension/manifest.json first: the store rejects a version it already has.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env (copy .env.example and fill it in)"; exit 1; }
set -a; . ./.env; set +a
for v in EXTENSION_ID PUBLISHER_ID CLIENT_ID CLIENT_SECRET REFRESH_TOKEN; do
  [ -n "${!v:-}" ] || { echo "Missing $v in .env"; exit 1; }
done
npm run lint
npm test
rm -f ad-speeder.zip && npm run package
echo "Uploading version $(node -p "require('./extension/manifest.json').version")..."
npx chrome-webstore-upload --source ad-speeder.zip
