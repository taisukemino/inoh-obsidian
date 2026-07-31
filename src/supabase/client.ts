import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../constants";
import { createAuthStorage } from "./auth-storage";

/**
 * Creates the Supabase client for this vault.
 *
 * Ported from the Inoh Raycast extension (`src/lib/supabase.ts`); the only
 * change is the auth storage adapter, which is backed by localStorage with a
 * per-vault prefix instead of Raycast's LocalStorage.
 *
 * @param vaultId - Stable identifier for the current vault, used to scope the session
 * @returns Configured Supabase client
 */
export function createSupabaseClient(vaultId: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: createAuthStorage(vaultId),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
