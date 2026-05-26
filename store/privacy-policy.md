# Pulse Conversations — Privacy Policy

_Last updated: 2026-05-26_

Pulse Conversations ("the Extension") is a Chrome extension that connects a user's browser to their own Salesforce organization to display meeting transcripts captured by the Pulse managed package.

## What the Extension accesses

- **Salesforce credentials** — handled by Google's `chrome.identity.launchWebAuthFlow` OAuth 2.0 flow against the user's Salesforce org. The Extension never sees the user's password.
- **OAuth tokens** — access and refresh tokens issued by the user's Salesforce org are stored locally via `chrome.storage.local` on the user's device.
- **Salesforce user ID** — the Extension reads the signed-in user's Salesforce user ID via `/services/oauth2/userinfo` to scope transcript matches to the correct bot owner. Stored locally.
- **Active tab URL** — when the side panel is open, the Extension reads the URL of the active browser tab to detect Google Meet, Zoom, or MS Teams meeting links. It does not read tab content, cookies, page DOM, or any other browsing data.
- **Salesforce data** — the Extension queries the user's own Salesforce org for `ple__Meeting__c` records and downloads the JSON transcript content associated with each meeting.

## What the Extension does NOT do

- The Extension does not transmit any data to any server other than the user's own Salesforce org.
- The Extension does not include analytics, telemetry, advertising, or third-party tracking scripts.
- The Extension does not sell, share, or transfer user data to any third party.
- The Extension does not access browsing history, page contents, downloads, bookmarks, or any other Chrome data.

## Data retention

OAuth tokens and configuration are retained on the user's local device until the user signs out via the Extension's UI or uninstalls the Extension. Signing out revokes the OAuth token with Salesforce and clears all local storage.

## Permissions used

| Permission | Purpose |
| --- | --- |
| `identity` | Run the Salesforce OAuth flow. |
| `storage` | Persist configuration and tokens locally. |
| `sidePanel` | Render the transcript UI in Chrome's side panel. |
| `tabs` | Read the active tab URL to match meeting links to Salesforce records. |
| Host permissions on `*.salesforce.com`, `*.force.com`, `*.my.salesforce.com` | Make OAuth-authenticated REST calls to the user's Salesforce org. |

## Contact

Questions about this policy can be sent to: **damian@madisonaveconsulting.com**
