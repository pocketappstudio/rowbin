/* Rowbin settings: the only file you need to edit to launch.
 *
 * GUMROAD_PRODUCT_ID: your Gumroad product's ID. Find it on the product's edit page
 *   (Content/Settings → "License key" section shows the product_id once you tick
 *   the option that gives each sale its own license key). Required for Pro unlocks to work.
 * CHECKOUT_URL: your Gumroad product link, e.g. "https://yourname.gumroad.com/l/rowbin".
 *   Set the product to a fixed price of $14.99 on Gumroad.
 * License keys are verified ONCE online with Gumroad when a buyer enters them; after
 *   that Pro works offline. Refunded / charged-back / disabled keys are refused, and
 *   (when online) keys are quietly re-checked every RECHECK_DAYS so refunds revoke Pro.
 * MAX_ACTIVATIONS: a key activated on more devices than this is refused.
 * DEV_MODE: keep false in production. When true, the test code ROWBIN-TEST also unlocks.
 */
window.ROWBIN_CONFIG = {
  APP_NAME: "Rowbin",
  PRO_PRICE: "$14.99",                       // shown in the app
  PRO_PRICE_NOTE: "One-time purchase, no subscription", // shown under the price
  CHECKOUT_URL: "https://pocketappstudio.gumroad.com/l/lxxun",
  GUMROAD_PRODUCT_ID: "UR9HK6ZOZUBfxT0VJK1qaA==",
  LICENSE_VERIFY_URL: "https://api.gumroad.com/v2/licenses/verify", // Gumroad allows browser (CORS) calls
  MAX_ACTIVATIONS: 5,
  RECHECK_DAYS: 30,                           // 0 = never re-check after activation
  FREE_PROJECT_LIMIT: 2,
  SUPPORT_EMAIL: "",                          // shown on About + in license errors

  DEV_MODE: false,
  DEV_UNLOCK_CODE_SHA256: [
    "1ba4b3d49fc53c510f2be38b049e823e5246b6aaee88008c18ec71254d22d66d" // ROWBIN-TEST (only works when DEV_MODE is true)
  ]
};
