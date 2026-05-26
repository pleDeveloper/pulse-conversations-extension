# Deploy without the Chrome Web Store

This is the path to push the extension into the Madison Ave Workspace org **without** going through Web Store review. It uses Chrome's enterprise force-install mechanism. It only works for users whose Chrome is managed by your Workspace org (signed into Chrome with a `@madisonaveconsulting.com` account, etc.). It does not work for personal Chrome installs outside that org — for those, only the Web Store path works.

## How it works

1. We pack the extension into a signed `.crx` file using a stable private key (`key.pem`).
2. We host the `.crx` + an `updates.xml` manifest at any HTTPS URL.
3. In the Google Workspace Admin Console (`admin.google.com`), we tell Chrome to force-install extension ID `glakobpfhjeknpmpahbfcjlfneinhgib` from that update URL.
4. Chrome on every managed user's machine reads `updates.xml`, downloads the `.crx`, verifies its signature against the public key embedded in `manifest.key`, and installs it silently.

The extension ID stays `glakobpfhjeknpmpahbfcjlfneinhgib` forever because it's derived from the public key we baked into `manifest.key`. New versions reuse the same key and ID — just bump `manifest.version` and re-pack.

## Step 1 — Build the package

```bash
# From repo root
./scripts/pack-crx.sh
```

Outputs:
- `dist/host/pulse-conversations.crx` — the signed extension
- `dist/host/updates.xml` — the update manifest (with a placeholder URL)

If you already know the public URL, set it via env var so the manifest lands ready to ship:

```bash
CRX_URL=https://files.madisonaveconsulting.com/pulse-conversations.crx ./scripts/pack-crx.sh
```

## Step 2 — Host the two files

Both files must be served over HTTPS from a stable URL. The `.crx` and `updates.xml` can live at the same path. Pick whichever is easiest:

### Option A — GitHub Releases (free, easiest)

1. In the repo: `gh release create v0.1.0 dist/host/pulse-conversations.crx --notes "Initial release"`
2. The asset is then permanently at:
   `https://github.com/pleDeveloper/pulse-conversations-extension/releases/download/v0.1.0/pulse-conversations.crx`
3. Edit `updates.xml` and put that URL in the `codebase` attribute, then commit `updates.xml` to the repo on `main`. Its public raw URL becomes:
   `https://raw.githubusercontent.com/pleDeveloper/pulse-conversations-extension/main/dist/host/updates.xml`

(Note: by default `dist/` is gitignored — for this path, force-add `updates.xml` only with `git add -f dist/host/updates.xml`.)

### Option B — S3 / Cloudflare R2 / your own bucket

Upload both files to a bucket with public read. Make sure `updates.xml` is served as `application/xml` and the `.crx` as `application/x-chrome-extension` (or `application/octet-stream` — Chrome doesn't care strictly).

### Option C — Salesforce static resource

Drop both files in a Salesforce Site / Experience Cloud public-facing static resource. The URL pattern is `https://<site>.force.com/resource/<name>/pulse-conversations.crx`. Works if you'd rather keep distribution inside the SF stack.

## Step 3 — Force-install via Workspace Admin Console

1. **admin.google.com** → **Devices** → **Chrome** → **Apps & extensions** → **Users & browsers**.
2. Select the Organizational Unit (e.g., root `madisonaveconsulting.com`, or a specific team).
3. Bottom-right yellow **+** button → **Add Chrome app or extension by ID**.
4. Fields:
   - **Extension ID**: `glakobpfhjeknpmpahbfcjlfneinhgib`
   - **From a custom URL**: paste the URL of `updates.xml` from Step 2.
5. Click **Save**.
6. Now click the extension's row in the list. On the right pane:
   - **Installation policy**: choose
     - `Force install` — silent, auto-installed for everyone in the OU
     - `Force install + pin to browser toolbar` — same, with the icon pinned (recommended for an actively-used tool)
     - `Allow install` — users can install it themselves but won't get it automatically
7. Click **Save** again.

Within ~30 minutes (or after a Chrome relaunch), every user in that OU has the extension. No Web Store. No review. No "remove untrusted extension" warning.

## Step 4 — Push updates

When you change the extension:

1. Bump `version` in `manifest.json`.
2. Re-run `./scripts/pack-crx.sh` with the same `CRX_URL`.
3. Upload the new `.crx` to the same host (overwrite, or use versioned filenames + update the URL).
4. Update the `version` attribute in `updates.xml`.
5. Chrome polls `updates.xml` every few hours; users get the new version silently.

## What if a user isn't in the managed org?

Two outs:
1. **Web Store unlisted** route (the parallel path we already submitted). Maddie can then push-install by ID without hosting anything.
2. **Per-user "Load unpacked"** — for devs only. Not for end users.

## Troubleshooting

- **"Failed to install extension from update URL"** in the admin console → check that `updates.xml` is publicly reachable over HTTPS (open it in an incognito tab; it should download or display the XML).
- **`CRX_HEADER_INVALID`** in Chrome → the `.crx` was modified after signing, or built with a non-PKCS#8 key. Re-run `scripts/pack-crx.sh`.
- **Extension installs but immediately disables** → the public key inside `manifest.key` doesn't match the key that signed the `.crx`. Make sure you didn't regenerate `key.pem` between `scripts/setup-extension-key.py` and `scripts/pack-crx.sh`.
