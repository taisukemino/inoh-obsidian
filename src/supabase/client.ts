import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { App } from "obsidian";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config";
import { createAuthStorage } from "./auth-storage";

/**
 * Creates the Supabase client for this vault.
 *
 * Ported from the Inoh Raycast extension (`src/lib/supabase.ts`); the only
 * change is the auth storage adapter, which is backed by Obsidian's
 * vault-scoped local storage instead of Raycast's LocalStorage.
 *
 * @param app - Obsidian app, used to scope the stored session to this vault
 * @returns Configured Supabase client
 */
export function createSupabaseClient(app: App): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: createAuthStorage(app),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
