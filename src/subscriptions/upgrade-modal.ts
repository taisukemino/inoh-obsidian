import { App, Modal, Notice, Setting } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_DAILY_SUGGESTION_LIMIT } from "../constants";
import {
  ActiveSubscriptionError,
  openBillingPortalUrl,
  startProCheckout,
} from "./subscription-service";

/**
 * Sends the user straight to Stripe Checkout for Inoh Pro — no web app in
 * between. Opened when the free daily suggestion cap is hit, and from the
 * plugin settings.
 *
 * Deliberately quotes no price: Stripe Checkout shows the current one, and a
 * number baked into a published plugin goes stale the first time pricing moves.
 */
export class UpgradeModal extends Modal {
  private isBusy = false;

  constructor(
    app: App,
    private readonly supabase: SupabaseClient,
    private readonly headline: string,
    private readonly onCheckoutOpened: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.headline);

    this.contentEl.createEl("p", {
      text:
        `Free accounts get ${FREE_DAILY_SUGGESTION_LIMIT} suggestion requests a day. ` +
        "Inoh Pro lifts that cap and raises the deck size used for suggestions, " +
        "so more of the words you're learning are in play.",
    });
    this.contentEl.createEl("p", {
      text: "Checkout opens in your browser. Come back here when you're done and your plan updates automatically.",
    });

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText("Upgrade to Inoh Pro")
          .setCta()
          .onClick(() => void this.openCheckout()),
      )
      .addButton((button) => button.setButtonText("Not now").onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private async openCheckout(): Promise<void> {
    if (this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      window.open(await startProCheckout(this.supabase));
      this.close();
      this.onCheckoutOpened();
    } catch (error) {
      if (error instanceof ActiveSubscriptionError) {
        await this.openBillingPortal();
        return;
      }
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Fallback when Stripe already has a live subscription for this account —
   * a second checkout would double-bill, so show the existing one instead.
   */
  private async openBillingPortal(): Promise<void> {
    try {
      window.open(await openBillingPortalUrl(this.supabase));
      this.close();
      this.onCheckoutOpened();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
}
