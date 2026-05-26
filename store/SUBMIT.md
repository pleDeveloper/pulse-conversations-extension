# Submitting Pulse Conversations to the Chrome Web Store (Unlisted)

Everything I can prepare for you is in this folder. You do the actual submission because it needs your Google account and developer fee payment.

## Files I prepared

| File | What it's for |
| --- | --- |
| `../pulse-conversations-0.1.0.zip` | The extension package to upload |
| `listing.md` | Copy/paste source for every text field in the dashboard |
| `privacy-policy.md` | Host this at a public URL and paste that URL into the dashboard |

## Step 1 — One-time dev account ($5)

1. Go to **https://chrome.google.com/webstore/devconsole** with the Google account you want to own the listing (Madison Ave Consulting Workspace account is the right call, since Maddie is rolling it out).
2. Pay the one-time **$5** developer registration fee.
3. Set up the publisher profile (Madison Ave Consulting). This is what users see as the developer name.

## Step 2 — Host the privacy policy

The Web Store requires a publicly reachable URL for the privacy policy.

Easiest option: **GitHub Gist** (free, takes 30 seconds).
1. Go to https://gist.github.com
2. Create a new gist named `pulse-conversations-privacy.md`, paste the contents of `privacy-policy.md`.
3. Click **Create public gist**.
4. Click **Raw** and copy that URL — that's what goes in the dashboard.

Alternative: host it on your own domain, GitHub Pages, or a Salesforce Site. Anything HTTPS works.

## Step 3 — Upload the ZIP

1. In the dev console, click **New item**.
2. Drag-and-drop `pulse-conversations-0.1.0.zip` (or browse to it).
3. After the upload, the dashboard shows you the **assigned Extension ID** at the top. **Copy it.** It will be 32 lowercase letters. It may or may not match `glakobpfhjeknpmpahbfcjlfneinhgib` — see Step 6.

## Step 4 — Fill out the store listing

Open `listing.md` in this folder and copy each block into the matching dashboard field:

- **Item name** — paste from listing.md
- **Summary** — paste
- **Description** — paste
- **Category** — Productivity
- **Language** — English (United States)
- **Single purpose** — paste
- **Permission justifications** — paste each one into the matching field. Web Store reviewers read these carefully; we already have honest answers.

## Step 5 — Upload assets

The Web Store requires:

- **One 128×128 icon** — already in the ZIP, dashboard picks it up automatically.
- **At least one screenshot at 1280×800 or 640×400.** You will need to take 1–3 screenshots of the running extension. Suggestions:
  1. The side panel mid-call, transcript visible, with the green "live" context bar at top.
  2. The meeting list view with the search bar.
  3. The options/settings page.

If you don't have time for polished screenshots, even a single dev-mode capture is enough to pass review.

## Step 6 — Privacy practices

In the **Privacy practices** tab:
- Paste the privacy policy URL from Step 2.
- Tick the disclosures and certifications exactly as listed in `listing.md` under "Privacy practices disclosures".

## Step 7 — Set visibility to Unlisted, submit

In **Distribution**:
- **Visibility**: choose **Unlisted**. Only people with the install link can find it; org admins can also force-install it by ID through the Google Workspace Admin Console.
- **Regions**: All.
- **Pricing**: Free.

Click **Submit for review**.

Unlisted reviews usually clear in **1–3 business days** but can be same-day.

## Step 8 — When approved, update the Connected App callback URL

The Chrome Web Store assigns its own canonical extension ID on first publish. If it differs from our current `glakobpfhjeknpmpahbfcjlfneinhgib`, the OAuth callback URL on the Connected App in each org needs to be updated to:

```
https://<NEW-ID>.chromiumapp.org/
https://<NEW-ID>.chromiumapp.org
```

(Both with and without trailing slash, so we don't get bitten by the trailing-slash mismatch we hit during dev.)

Send me the new ID and I'll re-deploy the Connected App in the TheOfficeHC org. For other orgs Maddie deploys to, the admin in that org will need to do the same — instructions are in the project README.

## Step 9 — Give Maddie the install link

Once approved, the dashboard shows the store URL (`https://chrome.google.com/webstore/detail/<id>`). Send Maddie that link, plus tell her she can also push-install by ID via Google Workspace Admin Console → Chrome → Apps & extensions → Users & browsers → "+" → **From Chrome Web Store** → paste the ID.

---

## Why I can't do steps 1–7 for you

- Step 1 requires your Google account login and a $5 charge to your card.
- Step 2 ideally lives on a domain you own (or your gist), not mine.
- Steps 3–7 happen inside the developer console which is logged into your Google account.

If you want me to keep iterating, send me the assigned extension ID after upload and I'll align the Connected App + write a per-org admin setup guide for new customers.
