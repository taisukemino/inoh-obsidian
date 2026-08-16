import { App, Modal, Notice, Platform } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeModalCloseButtons } from "../editor";
import { openExternalUrl } from "../ui";
import { formatPrice, planButtonLabel, yearlySavingPercent } from "./price-format";
import {
  ActiveSubscriptionError,
  fetchTierPrices,
  openBillingPortalUrl,
  startCheckout,
  TIER_DISPLAY_NAMES,
  UNKNOWN_TIER_PRICES,
  type BillingInterval,
  type PaidTier,
  type PlanPrice,
  type TierPrices,
} from "./subscription-service";

/**
 * What each paid tier buys, from the PRI-20152 pricing spec. The quotas are
 * enforced server-side; these strings only pitch them.
 */
const TIER_PITCHES: Record<PaidTier, string> = {
  plus: "Up to 1,000 cards, unlimited daily reviews + 1,000 pronunciation practices/month.",
  pro: "Everything in Plus, unlimited cards + 10,000 pronunciation practices/month.",
};

/** Plus is the target middle tier, so its card carries the "Most popular" badge. */
const HIGHLIGHTED_TIER: PaidTier = "plus";

/**
 * Sends the user straight to Stripe Checkout for a paid Inoh tier — no web app
 * in between. Opened from the plugin settings.
 *
 * Offers Plus and Pro on both billing intervals, labelled with prices read
 * live from Stripe so they cannot drift from what the user is actually
 * charged. Nothing is hardcoded: if the price lookup fails the buttons stay
 * usable, just unlabelled.
 */
export class UpgradeModal extends Modal {
  private isBusy = false;
  private isLoadingPrices = true;
  private prices: TierPrices = UNKNOWN_TIER_PRICES;

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
      this.prices = await fetchTierPrices(this.supabase);
    } catch (error) {
      console.error("Inoh: could not load subscription prices", error);
    } finally {
      // Repaint even on failure, so the price skeletons stop pulsing.
      this.isLoadingPrices = false;
      this.render();
    }
  }

  private render(): void {
    this.contentEl.empty();
    this.setTitle("Upgrade your Inoh plan");

    if (this.reason) {
      this.contentEl.createEl("p", { text: this.reason });
    }
    this.contentEl.createEl("p", {
      text: "Checkout opens in your browser. Come back here when you're done and your plan updates automatically.",
    });

    const cards = this.contentEl.createDiv({ cls: "inoh-plan-cards" });
    this.renderTierCard(cards, "plus");
    this.renderTierCard(cards, "pro");

    const dismissButton = this.contentEl.createEl("button", {
      cls: "inoh-plan-dismiss",
      text: "Not now",
    });
    dismissButton.addEventListener("click", () => this.close());
  }

  /**
   * One tier's card, styled after the inoh.app pricing cards: name, monthly
   * price, pitch, and a checkout button per billing interval. Both buttons
   * on both cards start checkout; the highlighted tier only gets a badge.
   */
  private renderTierCard(container: HTMLElement, tier: PaidTier): void {
    const tierPrices = this.prices[tier];
    const savingPercent = yearlySavingPercent(tierPrices);

    const card = container.createDiv({ cls: "inoh-plan-card" });
    if (tier === HIGHLIGHTED_TIER) {
      card.addClass("inoh-plan-card-highlighted");
      card.createDiv({ cls: "inoh-plan-badge", text: "Most popular" });
    }

    card.createDiv({ cls: "inoh-plan-name", text: `Inoh ${TIER_DISPLAY_NAMES[tier]}` });
    if (tierPrices.month || this.isLoadingPrices) {
      const priceLine = card.createDiv({ cls: "inoh-plan-price" });
      if (tierPrices.month) {
        priceLine.appendText(formatPrice(tierPrices.month));
      } else {
        priceLine.createSpan({ cls: "inoh-price-loading inoh-price-loading-large" });
      }
      priceLine.createSpan({ cls: "inoh-plan-price-interval", text: "/mo" });
    }
    card.createDiv({ cls: "inoh-plan-pitch", text: TIER_PITCHES[tier] });

    const buttons = card.createDiv({ cls: "inoh-plan-buttons" });
    this.renderCheckoutButton(buttons, "Yearly", tierPrices.year, savingPercent, tier, "year", true);
    this.renderCheckoutButton(buttons, "Monthly", tierPrices.month, null, tier, "month", false);
  }

  /** While prices load, the button shows its interval name with a pulse where the price goes. */
  private renderCheckoutButton(
    container: HTMLElement,
    intervalName: string,
    price: PlanPrice | null,
    savingPercent: number | null,
    tier: PaidTier,
    interval: BillingInterval,
    isPrimary: boolean,
  ): void {
    const button = container.createEl("button", {
      cls: isPrimary ? "inoh-plan-button inoh-plan-button-primary" : "inoh-plan-button",
    });
    if (price || !this.isLoadingPrices) {
      button.setText(planButtonLabel(intervalName, price, savingPercent));
    } else {
      button.appendText(`${intervalName} · `);
      button.createSpan({ cls: "inoh-price-loading" });
    }
    button.addEventListener("click", () => void this.openCheckout(tier, interval, button));
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private async openCheckout(
    tier: PaidTier,
    interval: BillingInterval,
    clickedButton: HTMLButtonElement,
  ): Promise<void> {
    if (this.isBusy) {
      return;
    }
    this.isBusy = true;
    // Reaching Stripe takes a moment; show it on the clicked button and hold
    // the others so a second click cannot start a competing checkout.
    const originalLabel = clickedButton.textContent ?? "";
    clickedButton.setText("Opening…");
    clickedButton.addClass("inoh-button-loading");
    this.setPlanButtonsDisabled(true);
    try {
      openExternalUrl(await startCheckout(this.supabase, tier, interval));
      this.close();
      this.onCheckoutOpened();
    } catch (error) {
      if (error instanceof ActiveSubscriptionError) {
        await this.openBillingPortal();
      } else {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.isBusy = false;
      // On the success path the modal is already closed; restoring detached
      // elements is harmless, and on errors the buttons come back usable.
      clickedButton.setText(originalLabel);
      clickedButton.removeClass("inoh-button-loading");
      this.setPlanButtonsDisabled(false);
    }
  }

  private setPlanButtonsDisabled(disabled: boolean): void {
    this.contentEl
      .querySelectorAll<HTMLButtonElement>("button.inoh-plan-button")
      .forEach((button) => (button.disabled = disabled));
  }

  /**
   * Fallback when Stripe already has a live subscription for this account —
   * a second checkout would double-bill, so show the existing one instead.
   */
  private async openBillingPortal(): Promise<void> {
    try {
      openExternalUrl(await openBillingPortalUrl(this.supabase));
      this.close();
      this.onCheckoutOpened();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
}
