/**
 * Supabase project credentials. The publishable key is anon-tier and safe to
 * ship — it is already hardcoded in the published Inoh Raycast extension.
 */
export const SUPABASE_URL = "https://fsgiabbxanlcaqpgrrki.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DvcLzEYwjUKsuGtzSJbivA_FLaRrKnh";

/**
 * Maximum number of cards a free-plan user can hold across all decks.
 * Enforced server-side by a trigger on `user_cards`. Also the reason the
 * whole deck can be fetched wholesale and matched in memory.
 */
export const FREE_CARD_LIMIT = 300;

/** Delay after the last keystroke before rescanning the viewport for deck words. */
export const HIGHLIGHT_REBUILD_DEBOUNCE_MS = 200;

/**
 * Typed tokens shorter than this never match via the weak (tolerant) tiers.
 * Prevents "a", "an", "to" from lighting up through typo-distance matching.
 */
export const MIN_FUZZY_TOKEN_LENGTH = 3;
