/** The Inoh web app (Expo web export). Word detail lives at /word/<dictionaryId>. */
export const WEB_APP_URL = "https://inoh.app";

/** Where "Open inoh.app" buttons land: the page for finding words to add. */
export const DISCOVER_URL = `${WEB_APP_URL}/discover`;

/**
 * Where Stripe returns the user after checkout. Static pages on inoh.app, not
 * `obsidian://` URIs: the stripe-subscribe edge function only accepts
 * redirect URLs Inoh owns (see _shared/stripe-redirect-urls.ts in
 * inoh-backend), and Stripe rejects unregistered custom schemes anyway.
 */
export const CHECKOUT_SUCCESS_URL = `${WEB_APP_URL}/checkout-success`;
export const CHECKOUT_CANCEL_URL = `${WEB_APP_URL}/checkout-cancel`;

/**
 * Product pages for the other Inoh ecosystem apps, shown in the Apps settings
 * group. The iOS app (mid-rebrand) has no URL yet and renders as
 * "Coming soon" — add its constant once live.
 */
export const CHROME_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/fihdhfkhbocbgmnhdigkljknabnjeoai?utm_source=item-share-cb";
export const RAYCAST_EXTENSION_URL = "https://www.raycast.com/tai/joey-vocab";


/** Delay after the last keystroke before rescanning the viewport for deck words. */
export const HIGHLIGHT_REBUILD_DEBOUNCE_MS = 200;

/**
 * Typed tokens shorter than this never match via the weak (tolerant) tiers.
 * Prevents "a", "an", "to" from lighting up through typo-distance matching.
 */
export const MIN_FUZZY_TOKEN_LENGTH = 3;
