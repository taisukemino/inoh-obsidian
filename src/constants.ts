/** The Inoh web app (Expo web export). Word detail lives at /word/<dictionaryId>. */
export const WEB_APP_URL = "https://inoh.app";

/**
 * Where Stripe returns the user after checkout. Static pages on inoh.app, not
 * `obsidian://` URIs: the stripe-subscribe edge function only accepts
 * redirect URLs Inoh owns (see _shared/stripe-redirect-urls.ts in
 * inoh-backend), and Stripe rejects unregistered custom schemes anyway.
 * `from` tells the page which app to send the user back to.
 */
export const CHECKOUT_SUCCESS_URL = `${WEB_APP_URL}/checkout-success?from=obsidian`;
export const CHECKOUT_CANCEL_URL = `${WEB_APP_URL}/checkout-cancel?from=obsidian`;

/**
 * Where the Stripe billing portal's "Return to Inoh" link lands. Its own page,
 * not the checkout-success one: a subscriber who only checked their invoices
 * must not be told "You're subscribed 🎉" as if they had just paid again.
 */
export const BILLING_PORTAL_RETURN_URL = `${WEB_APP_URL}/billing-return?from=obsidian`;

/**
 * Product pages for the other Inoh ecosystem apps, shown in the Apps settings
 * group. The iOS app (mid-rebrand) has no URL yet and renders as
 * "Coming soon" — add its constant once live.
 */
export const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/fihdhfkhbocbgmnhdigkljknabnjeoai?utm_source=item-share-cb";
export const RAYCAST_EXTENSION_URL = "https://www.raycast.com/tai/inoh";

/** Delay after the last keystroke before rescanning the viewport for deck words. */
export const HIGHLIGHT_REBUILD_DEBOUNCE_MS = 200;

/**
 * Typed tokens shorter than this never match via the weak (tolerant) tiers.
 * Prevents "a", "an", "to" from lighting up through typo-distance matching.
 */
export const MIN_FUZZY_TOKEN_LENGTH = 3;
