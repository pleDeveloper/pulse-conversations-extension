#!/usr/bin/env bash
# Build a clean zip for Chrome Web Store upload.
# - Strips the "key" field from manifest.json (Web Store rejects it)
# - Excludes key.pem (private!), dev tooling, sfdx project, README, scripts
# - Leaves the working-copy manifest.json untouched so your local unpacked
#   dev install keeps the same extension ID.

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(jq -r .version manifest.json)
OUT="pulse-conversations-${VERSION}.zip"
STAGE=$(mktemp -d)
trap "rm -rf '$STAGE'" EXIT

# Stage source, strip "key" from manifest
jq 'del(.key)' manifest.json > "$STAGE/manifest.json"
cp background.js sidepanel.html sidepanel.js sidepanel.css options.html options.js "$STAGE/"
cp -R icons "$STAGE/"

rm -f "$OUT"
( cd "$STAGE" && zip -r - manifest.json background.js sidepanel.html sidepanel.js sidepanel.css options.html options.js icons > /dev/null ) > /dev/null
( cd "$STAGE" && zip -r "$OLDPWD/$OUT" . > /dev/null )

echo "Built: $OUT"
unzip -l "$OUT"
echo
echo "Verifying no 'key' in zipped manifest:"
unzip -p "$OUT" manifest.json | jq 'has("key")'
