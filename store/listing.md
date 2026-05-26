# Chrome Web Store Listing — Pulse Conversations

Copy each block into the corresponding field in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Item name
`Pulse Conversations`

## Summary (max 132 chars)
`Side-panel viewer for Pulse meeting transcripts in Salesforce — auto-opens the transcript when you join a Google Meet.`

## Description
```
Pulse Conversations brings your Salesforce-stored meeting transcripts into a Chrome side panel, right next to the call.

When you join a Google Meet (or Zoom / MS Teams) that a Pulse bot is recording, the extension automatically opens the matching transcript from your Salesforce org. Multiple bots on the same call? It surfaces yours first, then falls back to the most recent capture if no bot of yours attended.

Features
• OAuth 2.0 with PKCE — never stores a client secret, never proxies through a third party.
• Live polling refresh of the transcript every 3 seconds.
• Slack-style speaker grouping with timestamps and color-coded avatars.
• Search and browse recent meetings even outside of a call.
• Works against your own Salesforce org via a Connected App you control.

Privacy
• Your Salesforce credentials never leave Google's OAuth flow.
• Transcript content is fetched directly from your Salesforce org; no external server is involved.
• No analytics, no third-party scripts.

Works with any Salesforce org that has the Pulse managed package installed. Each org admin creates a Connected App, sets the callback URL shown on the extension's options page, and shares the Consumer Key with their users.
```

## Category
`Productivity`

## Language
`English (United States)`

## Single-purpose description (required by Web Store)
```
The extension's single purpose is to display live transcripts of meetings recorded by the Pulse Salesforce managed package, in a side panel next to the active Google Meet / Zoom / Teams tab.
```

## Permission justifications

### `identity`
```
Required to authenticate the user against Salesforce via OAuth 2.0 PKCE using chrome.identity.launchWebAuthFlow. No tokens leave the user's machine.
```

### `storage`
```
Used to persist the org instance URL, OAuth Client ID, OAuth tokens, and the signed-in user's Salesforce user ID in chrome.storage.local. No data is sent anywhere besides the user's own Salesforce org.
```

### `sidePanel`
```
The extension's primary UI is a Chrome side panel that displays the transcript alongside the user's meeting tab.
```

### `tabs`
```
Required to read the active tab's URL so the extension can detect when the user is on a Google Meet / Zoom / Teams page and match it to the corresponding Salesforce meeting record. No tab content is read, only the URL.
```

### Host permissions (`https://*.salesforce.com/*`, `https://*.force.com/*`, `https://*.my.salesforce.com/*`)
```
The extension makes OAuth-authenticated REST calls to the user's own Salesforce org to retrieve meeting records and transcript content. These domains are the standard My Domain / Lightning Experience hosts.
```

## Privacy practices disclosures

For each data type, declare:

- **Authentication information**: Yes — collected and stored locally only; never transferred off-device except to the user's own Salesforce org via standard OAuth.
- **Personally identifiable information**: No (the extension does not collect anything beyond what Salesforce itself stores).
- **Personal communications**: No.
- **Web history / browsing activity**: No.
- **Location**: No.
- **Health info / financial / payment**: No.
- **User activity / Website content**: No.

Certify:
- ☑ I do not sell or transfer user data to third parties outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to the item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Visibility / Distribution
- **Visibility**: `Unlisted` (link-only; not in public store search)
- **Distribution regions**: `All regions`
- **Pricing**: `Free`
- **Mature content**: No

## Required assets to upload

| Asset | Spec | Status |
| --- | --- | --- |
| 128×128 icon | PNG | Already in `icons/icon128.png` (uploaded inside the ZIP) |
| Screenshots | 1280×800 or 640×400, JPG or 24-bit PNG, 1–5 images | **You need to take these** — see SUBMIT.md |
| Small promo tile | 440×280 PNG (optional but recommended for unlisted) | Optional |
