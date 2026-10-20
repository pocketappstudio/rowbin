# Rowbin: the cozy row counter (PWA)

A static, offline-first web app. No build step: every file in this folder is served as-is.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: **the only file to edit for launch** (Gumroad product ID, checkout URL, price wording, activation limit, DEV_MODE, support email)
- `sw.js`: service worker (offline). Bump `VERSION` when you publish changes.
- `manifest.webmanifest`, `icons/`: install-to-home-screen support
- `privacy.html`: standalone privacy policy (link it from Gumroad)
- `vendor/pdfjs/`: Mozilla pdf.js 3.11.174 legacy build (Apache-2.0), used for the Pro pattern viewer

## Pro unlock: Gumroad per-buyer license keys
- Each Gumroad sale gets its own license key. The buyer enters it once while online. The app calls
  `POST https://api.gumroad.com/v2/licenses/verify` (product_id, license_key, increment_uses_count)
  straight from the browser. **Gumroad allows CORS** (`Access-Control-Allow-Origin: *`; checked 2026-10-11), so no proxy/server is needed.
- On success the unlock is stored locally and Pro works offline from then on.
- Refused: unknown keys, keys for another product, disabled keys, refunded / charged-back / lost-dispute purchases.
- Activation limit: each new device activation increments Gumroad's `uses` count. Past `MAX_ACTIVATIONS` (default 5) the key is
  refused with a "contact us to reset" message. Re-entering the key on the same device doesn't use another activation.
  To reset a buyer's count, use Gumroad's "Decrement uses count" API or issue them a new key.
- Re-check: while online, the app quietly re-verifies about every `RECHECK_DAYS` (default 30). A refunded, charged-back or disabled
  key turns Pro off (projects are never touched). Network errors never remove Pro.
- Licenses are **never** copied from backup files, so sharing a backup doesn't share Pro.
- Dev/testing: set `DEV_MODE: true` in `config.js` to make `ROWBIN-TEST` unlock without the network. Keep it `false` in production
  (dev unlocks are ignored again once it's off). The old shared code `COZY-ROWS-7429` has been removed.
- Limits: it's still a client-side check. Someone technical can edit local storage or the JS to fake Pro. Per-buyer keys
  plus refund checks and activation limits stop casual sharing and refund abuse, which is where most leakage comes from.

### Gumroad setup (Slade)
1. Create the product (Digital product, e.g. "Rowbin Pro"). Price: **$14.99** fixed (one-time purchase, no subscription).
2. Product settings: turn on **unique license keys per sale** (Gumroad's license key option). Gumroad then shows the product's **product_id**.
3. Put the receipt text: "Open Rowbin → Settings → Enter license key, while connected to the internet."
4. In `config.js`, set `GUMROAD_PRODUCT_ID`, `CHECKOUT_URL` (the product link) and optionally `SUPPORT_EMAIL`, then bump `VERSION` in `sw.js` and redeploy.
5. Test with a Gumroad test purchase (buying your own product), then refund it and confirm the key is refused.

## Deploy (GitHub Pages)
Create a public repo, upload this folder's contents to the root, then Settings → Pages → Deploy from branch `main` / root.
The site lives at `https://<user>.github.io/<repo>/`. All paths are relative, so it works from a sub-path.

## Tests
Headless end-to-end tests are in `/workspace/rowcounter-tests/test_app.py` (68 checks; the Gumroad API is mocked with Playwright routing).
