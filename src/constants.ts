/** The Inoh web app (Expo web export). Word detail lives at /word/<dictionaryId>. */
export const WEB_APP_URL = "https://inoh.app";

/** Where "Open inoh.app" buttons land: the page for finding words to add. */
export const DISCOVER_URL = `${WEB_APP_URL}/discover`;

/**
 * Where Stripe returns the user after checkout. Static pages on inoh.app, not
 * `obsidian://` URIs: the stripe-subscribe edge function forwards these to
 * Stripe verbatim, and Stripe rejects unregistered custom schemes.
 */
export const CHECKOUT_SUCCESS_URL = `${WEB_APP_URL}/checkout-success`;
export const CHECKOUT_CANCEL_URL = `${WEB_APP_URL}/checkout-cancel`;


/** Delay after the last keystroke before rescanning the viewport for deck words. */
export const HIGHLIGHT_REBUILD_DEBOUNCE_MS = 200;

/**
 * Typed tokens shorter than this never match via the weak (tolerant) tiers.
 * Prevents "a", "an", "to" from lighting up through typo-distance matching.
 */
export const MIN_FUZZY_TOKEN_LENGTH = 3;
