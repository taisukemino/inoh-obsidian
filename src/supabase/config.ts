/**
 * Which Supabase backend this build talks to, baked in by esbuild.
 *
 * Mirrors the Inoh app's APP_ENV convention: `local` points at a local Supabase
 * stack running Stripe **test** keys, `prod` at the live project running Stripe
 * **live** keys — where a checkout is a real charge. `pnpm build` always targets
 * prod regardless of the environment, so a local URL can never ship.
 *
 * The publishable key is anon-tier and safe to ship — it is already hardcoded in
 * the published Inoh Raycast extension.
 *
 * Kept out of `constants.ts` so the pure modules that file also serves (matching
 * tunables) stay importable under vitest, which does not define these globals.
 */
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_PUBLISHABLE_KEY__: string;

export const SUPABASE_URL = __SUPABASE_URL__;
export const SUPABASE_PUBLISHABLE_KEY = __SUPABASE_PUBLISHABLE_KEY__;

/** Public storage bucket for word/definition/sentence audio. */
export const AUDIO_BUCKET_URL = `${SUPABASE_URL}/storage/v1/object/public/audio`;
