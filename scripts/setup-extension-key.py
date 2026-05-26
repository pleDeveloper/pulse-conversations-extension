#!/usr/bin/env python3
"""Generate an RSA key for the Chrome extension and compute its deterministic ID.

Run once. Writes:
  - key.pem (private key, keep local; do NOT ship)
  - .extension-info.json (id, pubkey-b64, callback URL)
And patches manifest.json with the "key" field so the extension always loads
with the same ID across machines.
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY_PEM = ROOT / "key.pem"
MANIFEST = ROOT / "manifest.json"
INFO = ROOT / ".extension-info.json"


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def main():
    if not KEY_PEM.exists():
        run(["openssl", "genrsa", "-out", str(KEY_PEM), "2048"])
    pub_der = run(
        ["openssl", "rsa", "-in", str(KEY_PEM), "-pubout", "-outform", "DER"]
    ).stdout

    digest = hashlib.sha256(pub_der).hexdigest()[:32]
    ext_id = "".join(chr(ord("a") + int(c, 16)) for c in digest)
    pub_b64 = base64.b64encode(pub_der).decode()
    callback = f"https://{ext_id}.chromiumapp.org/"

    manifest = json.loads(MANIFEST.read_text())
    manifest["key"] = pub_b64
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")

    INFO.write_text(
        json.dumps(
            {"extensionId": ext_id, "callbackUrl": callback, "publicKeyB64": pub_b64},
            indent=2,
        )
        + "\n"
    )

    print(f"Extension ID: {ext_id}")
    print(f"Callback URL: {callback}")


if __name__ == "__main__":
    main()
