#!/usr/bin/env bash
# Pack the extension into a self-hostable .crx and bump updates.xml.
# Uses local key.pem (which sets the stable extension ID via manifest.key).
#
# Requires: macOS with Google Chrome installed, openssl, jq.

set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[[ -x "$CHROME" ]] || { echo "Chrome not found at $CHROME"; exit 1; }
[[ -f key.pem ]] || { echo "key.pem missing — run scripts/setup-extension-key.py first"; exit 1; }

VERSION=$(jq -r .version manifest.json)
EXT_ID=$(jq -r .extensionId .extension-info.json 2>/dev/null || echo "glakobpfhjeknpmpahbfcjlfneinhgib")

# Public URL the .crx will live at — override at call time, e.g.
#   CRX_URL=https://files.madisonaveconsulting.com/pulse-conversations.crx ./scripts/pack-crx.sh
CRX_URL="${CRX_URL:-https://CHANGE-ME.example.com/pulse-conversations.crx}"

WORK=$(mktemp -d)
trap "rm -rf '$WORK'" EXIT

# Stage clean source (no key.pem, no zip, no SFDX state)
mkdir -p "$WORK/source"
cp -R manifest.json background.js sidepanel.html sidepanel.js sidepanel.css \
      options.html options.js icons "$WORK/source/"

# Convert PKCS#1 → PKCS#8 (Chrome's --pack-extension-key requires PKCS#8)
openssl pkcs8 -topk8 -nocrypt -in key.pem -out "$WORK/key.pkcs8.pem" 2>/dev/null

# Pack
"$CHROME" \
  --pack-extension="$WORK/source" \
  --pack-extension-key="$WORK/key.pkcs8.pem" >/dev/null

mkdir -p dist/host
mv "$WORK/source.crx" dist/host/pulse-conversations.crx

# Write updates.xml
cat > dist/host/updates.xml <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="$EXT_ID">
    <updatecheck codebase="$CRX_URL" version="$VERSION" />
  </app>
</gupdate>
EOF

echo "Built dist/host/:"
ls -la dist/host/
echo
echo "Extension ID: $EXT_ID"
echo "Version:      $VERSION"
echo "CRX URL:      $CRX_URL"
[[ "$CRX_URL" == *CHANGE-ME* ]] && echo "WARNING: CRX_URL not set — updates.xml still has the placeholder." >&2 || true
