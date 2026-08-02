import { App, Modal, Notice, Setting } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
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
 * Quotes neither the price nor the daily limit: Stripe Checkout shows the
 * current price, and the server owns the limit and names it in the message it
 * sends back. Either number baked in here goes stale the first time it changes.
 */
export class UpgradeModal extends Modal {
  private isBusy = false;

  /**
   * @param reason - The server's explanation of why the upgrade is being
   *   offered, shown verbatim. Omitted when opened from settings.
   */
  constructor(
    app: App,
    private readonly supabase: SupabaseClient,
    private readonly reason: string | null,
    private readonly onCheckoutOpened: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Upgrade to Inoh Pro");

    if (this.reason) {
      this.contentEl.createEl("p", { text: this.reason });
    }
    this.contentEl.createEl("p", {
      text:
        "Inoh Pro removes the daily suggestion cap and raises the deck size used " +
        "for suggestions, so more of the words you're learning are in play.",
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
