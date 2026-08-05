import { App, Modal, Notice, Platform, Setting } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeModalCloseButtons } from "../editor/remove-modal-close-buttons";
import { planButtonLabel, yearlySavingPercent } from "./price-format";
import {
  ActiveSubscriptionError,
  fetchProPrices,
  openBillingPortalUrl,
  startProCheckout,
  type BillingInterval,
  type ProPrices,
} from "./subscription-service";

/**
 * Sends the user straight to Stripe Checkout for Inoh Pro — no web app in
 * between. Opened when the free daily suggestion cap is hit, and from the
 * plugin settings.
 *
 * Offers both billing intervals, labelled with prices read live from Stripe so
 * they cannot drift from what the user is actually charged. Nothing is
 * hardcoded: the daily limit comes from the server's own message, and if the
 * price lookup fails the buttons stay usable, just unlabelled.
 */
export class UpgradeModal extends Modal {
  private isBusy = false;
  private prices: ProPrices = { month: null, year: null };

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
    this.modalEl.addClass("inoh-modal");
    // Mobile's dialog X is an oversized circle that fights the cream card;
    // tap-outside and swipe-down still close. Desktop keeps its small ×.
    if (Platform.isMobile) {
      removeModalCloseButtons(this.containerEl);
    }
    this.render();
    void this.loadPrices();
  }

  /**
   * Prices come from Stripe, so the modal opens immediately with bare interval
   * labels and repaints once they arrive. A failure is not surfaced: the user
   * came here to upgrade, and unlabelled buttons still do that.
   */
  private async loadPrices(): Promise<void> {
    try {
      this.prices = await fetchProPrices(this.supabase);
      this.render();
    } catch (error) {
      console.error("Inoh: could not load Pro prices", error);
    }
  }

  private render(): void {
    this.contentEl.empty();
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

    const savingPercent = yearlySavingPercent(this.prices);

    new Setting(this.contentEl)
      .setName("Choose a billing interval")
      .setDesc("Stripe confirms the exact amount before you pay.")
      .addButton((button) =>
        button
          .setButtonText(planButtonLabel("Yearly", this.prices.year, savingPercent))
          .setCta()
          .onClick(() => void this.openCheckout("year")),
      )
      .addButton((button) =>
        button
          .setButtonText(planButtonLabel("Monthly", this.prices.month))
          .onClick(() => void this.openCheckout("month")),
      );

    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText("Not now").onClick(() => this.close()),
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private async openCheckout(plan: BillingInterval): Promise<void> {
    if (this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      window.open(await startProCheckout(this.supabase, plan));
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
