import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads the display name the user chose in the Inoh app.
 *
 * Accounts are created by email OTP, which carries no name, so `profiles` may
 * have no row or no username — the caller falls back to the email.
 *
 * @param supabase - Signed-in Supabase client
 * @param userId - The signed-in user's id
 * @returns The username, or null when the account has not set one
 * @throws {Error} When the query fails
 */
export async function fetchUsername(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("username")
    .eq("user_id", userId)
    .maybeSingle<{ username: string | null }>();

  if (error) {
    throw new Error(`Could not read your profile: ${error.message}`);
  }
  return data?.username ?? null;
}
