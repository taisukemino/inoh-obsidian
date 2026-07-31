import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Requests a one-time login code to be emailed to the given address.
 *
 * Works for both new and returning users: an unknown email creates the account,
 * a known email signs in.
 *
 * @param supabase - Supabase client for this vault
 * @param email - Inoh account email to send the code to
 * @throws {Error} When the code could not be sent
 */
export async function requestEmailCode(supabase: SupabaseClient, email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Verifies the emailed one-time code and returns the authenticated user.
 *
 * @param supabase - Supabase client for this vault
 * @param email - Email the code was sent to
 * @param code - Six-digit code from the email
 * @returns Authenticated user object
 * @throws {Error} When the code is invalid, expired, or verification fails
 */
export async function verifyEmailCode(
  supabase: SupabaseClient,
  email: string,
  code: string,
): Promise<User> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.user) {
    throw new Error("Verification succeeded but no user was returned.");
  }

  return data.user;
}

/**
 * Signs the current user out and clears the persisted session.
 *
 * @param supabase - Supabase client for this vault
 * @throws {Error} When sign-out fails
 */
export async function signOutUser(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}
