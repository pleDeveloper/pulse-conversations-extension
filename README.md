# Pulse Conversations — Chrome Extension

Side-panel viewer for Pulse live transcripts. Reads the `Meeting_Transcript_*` JSON ContentVersion attached to `ple__Meeting__c` records and renders it in a Slack-style dark UI with live polling.

Default target org: **pulse@agentforce.com** (theofficehc-dev-ed.develop.my.salesforce.com), but any org with the Pulse managed package works.

## Already provisioned (TheOfficeHC org)

The Connected App is already deployed to `pulse@agentforce.com` and the extension has a stable ID via `manifest.key`. Values are also in `.extension-info.json`.

| Field | Value |
| --- | --- |
| Extension ID | `glakobpfhjeknpmpahbfcjlfneinhgib` |
| Callback URL | `https://glakobpfhjeknpmpahbfcjlfneinhgib.chromiumapp.org/` |
| Instance URL | `https://theofficehc-dev-ed.develop.my.salesforce.com` |
| Connected App | `Pulse Conversations Extension` |
| Consumer Key | `3MVG9rZjd7MXFdLhPX5wdzr9rbQ0ljtFW5UE0m_c8JWxusiRmUEOVsC21kiCj_yJLtNPfuoDqwEJJwCFPzPNQ` |

## Install (developer mode)

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this folder.
2. Verify the ID Chrome assigns matches `glakobpfhjeknpmpahbfcjlfneinhgib` — it will, because of the `key` field in `manifest.json`.
3. Click the extension icon → gear → paste the Instance URL and Consumer Key from the table above → Save.
4. Back in the side panel, click **Sign in**. First sign-in may take up to ~10 minutes after the Connected App was deployed (Salesforce OAuth policy propagation).

## Re-deploying the Connected App

If the extension ID changes (e.g., you regenerate `key.pem`), update the callback URL and re-deploy:

```bash
python3 scripts/setup-extension-key.py            # regenerates ID, patches manifest.json
# edit sfdx/force-app/main/default/connectedApps/Pulse_Conversations_Extension.connectedApp-meta.xml
# replace the callbackUrl with the new https://<id>.chromiumapp.org/
sf project deploy start --target-org theoffice --source-dir sfdx/force-app
```

## Re-creating the Connected App in a different org

```bash
sf project deploy start --target-org <alias> --source-dir sfdx/force-app
sf project retrieve start --target-org <alias> --metadata "ConnectedApp:Pulse_Conversations_Extension"
# Consumer Key will be in the retrieved XML's <consumerKey> element
```

## How it works

- `background.js` runs OAuth 2.0 Authorization Code + PKCE via `chrome.identity.launchWebAuthFlow`, stores access/refresh tokens in `chrome.storage.local`, and refreshes on 401.
- Side panel queries `ple__Meeting__c` for recent meetings, with search by meeting name or account name.
- Opening a meeting calls `ContentDocumentLink` → `ContentVersion` (filter `FileType='JSON'` and `Title LIKE 'Meeting_Transcript_%'`), then downloads `/VersionData` and parses the JSON (`{sequence, participantName, message, createDate}` shape).
- Messages are grouped by speaker with avatar/timestamp, mirroring the existing `pulseLiveTranscriptV2` LWC. The Live toggle polls every 3 seconds.

## Files

```
manifest.json         MV3 manifest, side_panel + identity + storage
background.js         OAuth, token refresh, Salesforce REST calls
sidepanel.html/.js    Search → meeting list → transcript viewer
sidepanel.css         Slack-dark theme shared with options page
options.html/.js      Instance URL + Client ID config
icons/                16/32/128 PNGs
```

## Limitations / next steps

- Read-only: no message reactions, replies, or pin-to-action yet (see LWC for the full feature set).
- No video player or coaching panel.
- SOQL search uses `LIKE` (basic). Could move to SOSL for fuzzier matches.
- Polling is a flat 3s; consider Platform Event subscription via cometd if you want true push.
