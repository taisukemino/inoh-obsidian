import { Notice, type App } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchUsername } from "../supabase";
import { openExternalUrl } from "../ui";
import {
  fetchSubscriptionState,
  isPaidTier,
  openBillingPortalUrl,
  FREE_SUBSCRIPTION,
  TIER_DISPLAY_NAMES,
  type SubscriptionState,
} from "./subscription-service";
import { UpgradeModal } from "./upgrade-modal";

/**
 * Owns what the signed-in account is entitled to, beyond the session itself:
 * the subscription plan, the display name, and the round-trips to Stripe
 * (checkout, billing portal) that change the plan.
 */
export class AccountService {
  subscription: SubscriptionState = FREE_SUBSCRIPTION;
  /** True when the last plan read failed, so "Free plan" may be wrong. */
  subscriptionCheckFailed = false;
  /** Display name from the Inoh app; null for accounts that never set one. */
  username: string | null = null;
  /** Which Stripe flow the user was sent to, until they come back from it. */
  private pendingStripeReturn: "checkout" | "portal" | null = null;

  constructor(
    private readonly app: App,
    private readonly supabase: SupabaseClient,
    /** The signed-in user's id, read live so sign-in/out is always current. */
    private readonly getUserId: () => string | null,
    /** Repaints whatever shows the plan and name — the settings tab. */
    private readonly onChanged: () => void,
  ) {}

  /**
   * Reads the current plan and display name. Falls back to free so features
   * stay gated, but records the failure — silently showing "Free plan" to a
   * paying subscriber is indistinguishable from them genuinely not having paid.
   */
  async refresh(): Promise<void> {
    const userId = this.getUserId();
    if (!userId) {
      this.subscription = FREE_SUBSCRIPTION;
      this.subscriptionCheckFailed = false;
      this.username = null;
      this.onChanged();
      return;
    }
    try {
      this.subscription = await fetchSubscriptionState(this.supabase, userId);
      this.subscriptionCheckFailed = false;
    } catch (error) {
      console.error("Inoh: could not read the subscription plan", error);
      this.subscription = FREE_SUBSCRIPTION;
      this.subscriptionCheckFailed = true;
    }
    try {
      this.username = await fetchUsername(this.supabase, userId);
    } catch (error) {
      // A missing display name is cosmetic; the email still identifies them.
      console.error("Inoh: could not read the profile", error);
      this.username = null;
    }
    this.onChanged();
  }

  /**
   * Opens the upgrade modal offering Inoh Plus and Pro. Called from the
   * settings tab's Upgrade button.
   *
   * @param reason - The server's explanation of why the upgrade is offered,
   *   or null when the user opened this themselves from settings
   */
  promptUpgrade(reason: string | null): void {
    new UpgradeModal(this.app, this.supabase, reason, () => {
      this.pendingStripeReturn = "checkout";
    }).open();
  }

  /**
   * Opens the Stripe billing portal, where the user can change payment details
   * or cancel. Reached from the settings Manage button.
   */
  async openBillingPortal(): Promise<void> {
    try {
      openExternalUrl(await openBillingPortalUrl(this.supabase));
      // The portal can change the plan, so re-read it when the user returns.
      this.pendingStripeReturn = "portal";
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Re-reads the plan after the user comes back from Stripe. The webhook that
   * flips the account onto a paid plan can land after they switch back, so
   * this stays armed and retries on the next focus until the plan shows up.
   */
  async pickUpStripeReturn(): Promise<void> {
    const pendingFlow = this.pendingStripeReturn;
    const userId = this.getUserId();
    if (!pendingFlow || !userId) {
      return;
    }
    try {
      const wasPaid = isPaidTier(this.subscription.tier);
      this.subscription = await fetchSubscriptionState(this.supabase, userId);
      // The user is often still looking at the settings tab they launched the
      // Stripe flow from, so repaint it with whatever the read found —
      // including a cancellation notice, not just an upgrade.
      this.onChanged();

      // The portal writes its changes before the user leaves it, so one read is
      // enough — and it may well have cancelled rather than upgraded.
      if (pendingFlow === "portal") {
        this.pendingStripeReturn = null;
        return;
      }
      // Checkout's webhook can land after the user switches back, so stay armed
      // and retry on each focus until the paid plan actually shows up.
      if (!wasPaid && isPaidTier(this.subscription.tier)) {
        this.pendingStripeReturn = null;
        new Notice(
          `You're on Inoh ${TIER_DISPLAY_NAMES[this.subscription.tier]} — thanks for subscribing!`,
        );
      }
    } catch (error) {
      console.error("Inoh: could not re-read the subscription after Stripe", error);
    }
  }

  /** Drops everything back to the signed-out defaults. Called on sign-out. */
  reset(): void {
    this.subscription = FREE_SUBSCRIPTION;
    this.subscriptionCheckFailed = false;
    this.username = null;
    this.pendingStripeReturn = null;
  }
}
