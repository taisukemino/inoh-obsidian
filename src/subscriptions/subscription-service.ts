import { FunctionsHttpError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHECKOUT_CANCEL_URL, CHECKOUT_SUCCESS_URL } from "../constants";

/**
 * Thrown when the account already has a live Stripe subscription, so checkout
 * would double-bill (edge function code `subscription_exists`). The caller
 * should send the user to the billing portal instead.
 */
export class ActiveSubscriptionError extends Error {}

/** Row shape read from `subscriptions`; the plugin only needs the plan state. */
type SubscriptionRow = { plan: string; status: string };

/** Billing interval, matching the values stripe-subscribe resolves prices for. */
export type BillingInterval = "month" | "year";

export type PlanPrice = {
  /** Smallest currency unit, e.g. 799 for $7.99. */
  unitAmount: number;
  /** ISO 4217, lowercased (e.g. "usd"). */
  currency: string;
};

/** Live prices per interval. Either may be null if Stripe has none configured. */
export type ProPrices = Record<BillingInterval, PlanPrice | null>;

/**
 * Reads the live Inoh Pro prices from Stripe via the subscription-prices
 * function, so the upgrade modal can show real numbers rather than a hardcoded
 * price that goes stale the moment pricing changes.
 *
 * @param supabase - Signed-in Supabase client
 * @returns The price per interval
 * @throws {Error} When the request fails
 */
export async function fetchProPrices(supabase: SupabaseClient): Promise<ProPrices> {
  const { data, error } = await supabase.functions.invoke<ProPrices>("subscription-prices", {
    body: {},
  });

  if (error) {
    throw await toFriendlyError(error, "Could not load prices.");
  }
  return { month: data?.month ?? null, year: data?.year ?? null };
}

/**
 * Asks stripe-subscribe for a hosted Stripe Checkout URL for Inoh Pro.
 *
 * Sends the interval rather than a Stripe price ID so pricing can change
 * without a plugin release — the edge function resolves the ID from its own
 * secrets.
 *
 * @param supabase - Signed-in Supabase client
 * @param plan - Billing interval to subscribe on
 * @returns The hosted Stripe Checkout URL to open in a browser
 * @throws {ActiveSubscriptionError} When the account already subscribes
 * @throws {Error} When the request fails for any other reason
 */
export async function startProCheckout(
  supabase: SupabaseClient,
  plan: BillingInterval,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string }>("stripe-subscribe", {
    body: {
      plan,
      successUrl: CHECKOUT_SUCCESS_URL,
      cancelUrl: CHECKOUT_CANCEL_URL,
    },
  });

  if (error) {
    throw await toFriendlyError(error, "Could not start checkout. Check your connection and try again.");
  }
  if (!data?.url) {
    throw new Error("Stripe did not return a checkout page. Try again in a moment.");
  }
  return data.url;
}

/**
 * Asks manage-subscription for a Stripe billing portal URL, where the user can
 * see and change an existing subscription.
 *
 * @param supabase - Signed-in Supabase client
 * @returns The hosted billing portal URL to open in a browser
 * @throws {Error} When the request fails
 */
export async function openBillingPortalUrl(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string }>("manage-subscription", {
    body: { returnUrl: CHECKOUT_SUCCESS_URL },
  });

  if (error) {
    throw await toFriendlyError(error, "Could not open your billing settings. Try again in a moment.");
  }
  if (!data?.url) {
    throw new Error("Stripe did not return a billing page. Try again in a moment.");
  }
  return data.url;
}

/**
 * Reads whether the signed-in user is on Inoh Pro.
 *
 * `plan = 'pro' AND status = 'active'` is the entitlement predicate used across
 * Inoh — the web app, the suggest-deck-words edge function, and the free card
 * limit trigger all test it. Every account has a `subscriptions` row seeded at
 * signup, so `status` alone means nothing. RLS restricts the read to the
 * caller's own row.
 *
 * @param supabase - Signed-in Supabase client
 * @param userId - The signed-in user's id
 * @returns True when the account is on an active Pro subscription
 * @throws {Error} When the query fails
 */
export async function fetchIsPro(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .maybeSingle<SubscriptionRow>();

  if (error) {
    throw new Error(`Could not check your subscription: ${error.message}`);
  }
  return data?.plan === "pro" && data.status === "active";
}

/** Error body returned by the edge functions alongside a non-2xx status. */
type SubscriptionErrorBody = { error?: string; code?: string };

async function toFriendlyError(error: unknown, fallbackMessage: string): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const response = error.context as Response;
      const body = (await response.json()) as SubscriptionErrorBody;
      if (body.code === "subscription_exists") {
        return new ActiveSubscriptionError(
          body.error ?? "This account already has an Inoh Pro subscription.",
        );
      }
      if (body.error) {
        return new Error(body.error);
      }
    } catch {
      // Fall through to the generic message.
    }
  }
  return new Error(fallbackMessage);
}
