import { FunctionsHttpError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BILLING_PORTAL_RETURN_URL, CHECKOUT_CANCEL_URL, CHECKOUT_SUCCESS_URL } from "../constants";
import { invokeEdgeFunction } from "../supabase";

/**
 * Thrown when the account already has a live Stripe subscription, so checkout
 * would double-bill (edge function code `subscription_exists`). The caller
 * should send the user to the billing portal instead.
 */
export class ActiveSubscriptionError extends Error {}

/** The columns of `subscriptions` the plugin reads. */
type SubscriptionRow = {
  plan: string;
  status: string;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
};

/** The plan slugs stored in `subscriptions.plan`. */
export type SubscriptionTier = "free" | "plus" | "pro";

/** The tiers that can be bought through Stripe Checkout. */
export type PaidTier = "plus" | "pro";

/** Human name for each tier — the "Plus" in "Inoh Plus". */
export const TIER_DISPLAY_NAMES: Record<SubscriptionTier, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
};

/**
 * Whether a tier is entitled to paid features.
 *
 * @param tier - The tier the user is on right now
 * @returns True for Plus and Pro
 */
export function isPaidTier(tier: SubscriptionTier): boolean {
  return tier !== "free";
}

export type SubscriptionState = {
  /** The tier the user is entitled to right now; "free" when a paid plan lapsed. */
  tier: SubscriptionTier;
  /**
   * A Stripe subscription exists that can still bill or recover — including
   * `past_due`, where the user is not entitled but does need the billing portal
   * to fix their card. Mirrors `hasLiveStripeSubscription` in the Inoh app.
   */
  hasLiveStripeSubscription: boolean;
  /** True when the paid plan is winding down at the end of the paid period. */
  cancelAtPeriodEnd: boolean;
  /** ISO timestamp the paid plan lapses on, when it is winding down. */
  currentPeriodEnd: string | null;
};

export const FREE_SUBSCRIPTION: SubscriptionState = {
  tier: "free",
  hasLiveStripeSubscription: false,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
};

/** Statuses where a paid plan is entitled — the backend's predicate, verbatim. */
const ENTITLED_STATUSES = new Set(["active", "trialing"]);

/** Statuses where Stripe still has a subscription that can bill or recover. */
const LIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Billing interval, matching the values stripe-subscribe resolves prices for. */
export type BillingInterval = "month" | "year";

export type PlanPrice = {
  /** Smallest currency unit, e.g. 499 for $4.99. */
  unitAmount: number;
  /** ISO 4217, lowercased (e.g. "usd"). */
  currency: string;
};

/** One tier's live prices per interval. Either may be null if Stripe has none configured. */
export type IntervalPrices = Record<BillingInterval, PlanPrice | null>;

/** Live prices for both paid tiers, the shape subscription-prices returns. */
export type TierPrices = Record<PaidTier, IntervalPrices>;

/** What the upgrade modal shows until the live prices arrive from Stripe. */
export const UNKNOWN_TIER_PRICES: TierPrices = {
  plus: { month: null, year: null },
  pro: { month: null, year: null },
};

/**
 * Reads the live Inoh Plus and Pro prices from Stripe via the
 * subscription-prices function, so the upgrade modal can show real numbers
 * rather than a hardcoded price that goes stale the moment pricing changes.
 *
 * @param supabase - Signed-in Supabase client
 * @returns The price per tier and interval
 * @throws {Error} When the request fails
 */
export async function fetchTierPrices(supabase: SupabaseClient): Promise<TierPrices> {
  const { data, error } = await invokeEdgeFunction<Partial<TierPrices>>(
    supabase,
    "subscription-prices",
    {},
  );

  if (error) {
    throw await toFriendlyError(error, "Could not load prices.");
  }
  return {
    plus: { month: data?.plus?.month ?? null, year: data?.plus?.year ?? null },
    pro: { month: data?.pro?.month ?? null, year: data?.pro?.year ?? null },
  };
}

/**
 * Asks stripe-subscribe for a hosted Stripe Checkout URL for a paid Inoh tier.
 *
 * Sends the tier and interval rather than a Stripe price ID so pricing can
 * change without a plugin release — the edge function resolves the ID from its
 * own secrets.
 *
 * @param supabase - Signed-in Supabase client
 * @param tier - Paid tier to subscribe to
 * @param interval - Billing interval to subscribe on
 * @returns The hosted Stripe Checkout URL to open in a browser
 * @throws {ActiveSubscriptionError} When the account already subscribes
 * @throws {Error} When the request fails for any other reason
 */
export async function startCheckout(
  supabase: SupabaseClient,
  tier: PaidTier,
  interval: BillingInterval,
): Promise<string> {
  const { data, error } = await invokeEdgeFunction<{ url?: string }>(supabase, "stripe-subscribe", {
    tier,
    interval,
    successUrl: CHECKOUT_SUCCESS_URL,
    cancelUrl: CHECKOUT_CANCEL_URL,
  });

  if (error) {
    throw await toFriendlyError(
      error,
      "Could not start checkout. Check your connection and try again.",
    );
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
  const { data, error } = await invokeEdgeFunction<{ url?: string }>(
    supabase,
    "manage-subscription",
    { returnUrl: BILLING_PORTAL_RETURN_URL },
  );

  if (error) {
    throw await toFriendlyError(
      error,
      "Could not open your billing settings. Try again in a moment.",
    );
  }
  if (!data?.url) {
    throw new Error("Stripe did not return a billing page. Try again in a moment.");
  }
  return data.url;
}

/**
 * Reads the signed-in user's subscription state.
 *
 * A paid plan (`plus` or `pro`) is entitled while its status is `active` or
 * `trialing` — the same predicate the backend uses everywhere. Every account
 * has a `subscriptions` row seeded at signup, so `status` alone means nothing.
 * RLS restricts the read to the caller's own row.
 *
 * @param supabase - Signed-in Supabase client
 * @param userId - The signed-in user's id
 * @returns The plan state, or the free defaults when there is no row
 * @throws {Error} When the query fails
 */
export async function fetchSubscriptionState(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionState> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan, status, stripe_subscription_id, cancel_at_period_end, current_period_end")
    .eq("user_id", userId)
    .maybeSingle<SubscriptionRow>();

  if (error) {
    throw new Error(`Could not check your subscription: ${error.message}`);
  }
  if (!data) {
    return FREE_SUBSCRIPTION;
  }
  const isEntitledPaidPlan =
    (data.plan === "plus" || data.plan === "pro") && ENTITLED_STATUSES.has(data.status);
  return {
    tier: isEntitledPaidPlan ? (data.plan as PaidTier) : "free",
    hasLiveStripeSubscription:
      Boolean(data.stripe_subscription_id) && LIVE_STRIPE_STATUSES.has(data.status),
    cancelAtPeriodEnd: data.cancel_at_period_end === true,
    currentPeriodEnd: data.current_period_end,
  };
}

/** Error body returned by the edge functions alongside a non-2xx status. */
type SubscriptionErrorBody = { error?: string; code?: string; detail?: string | null };

async function toFriendlyError(error: unknown, fallbackMessage: string): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const response = error.context as Response;
      const body = (await response.json()) as SubscriptionErrorBody;
      if (body.code === "subscription_exists") {
        return new ActiveSubscriptionError(
          body.error ?? "This account already has an Inoh subscription.",
        );
      }
      if (body.error) {
        // The edge functions put the upstream (Stripe) message in `detail` —
        // without it, failures like a missing live-mode portal configuration
        // are indistinguishable from network blips.
        return new Error(body.detail ? `${body.error} ${body.detail}` : body.error);
      }
    } catch {
      // Fall through to the generic message.
    }
  }
  return new Error(fallbackMessage);
}
