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
  type TierPrices,
} from "./subscription-service";

/**
 * What each paid tier buys, from the PRI-20152 pricing spec. The quotas are
 * enforced server-side; these strings only pitch them.
 */
const TIER_PITCHES: Record<PaidTier, string> = {
  plus: "Up to 2,000 cards, unlimited daily reviews + 30 pronunciation practices/day.",
  pro: "Everything in Plus, unlimited cards + 300 pronunciation practices/day.",
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
      this.render();
    } catch (error) {
      console.error("Inoh: could not load subscription prices", error);
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
    if (tierPrices.month) {
      const priceLine = card.createDiv({ cls: "inoh-plan-price" });
      priceLine.appendText(formatPrice(tierPrices.month));
      priceLine.createSpan({ cls: "inoh-plan-price-interval", text: "/mo" });
    }
    card.createDiv({ cls: "inoh-plan-pitch", text: TIER_PITCHES[tier] });

    const buttons = card.createDiv({ cls: "inoh-plan-buttons" });
    this.renderCheckoutButton(
      buttons,
      planButtonLabel("Yearly", tierPrices.year, savingPercent),
      tier,
      "year",
      true,
    );
    this.renderCheckoutButton(buttons, planButtonLabel("Monthly", tierPrices.month), tier, "month", false);
  }

  private renderCheckoutButton(
    container: HTMLElement,
    label: string,
    tier: PaidTier,
    interval: BillingInterval,
    isPrimary: boolean,
  ): void {
    const button = container.createEl("button", {
      cls: isPrimary ? "inoh-plan-button inoh-plan-button-primary" : "inoh-plan-button",
      text: label,
    });
    button.addEventListener("click", () => void this.openCheckout(tier, interval));
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private async openCheckout(tier: PaidTier, interval: BillingInterval): Promise<void> {
    if (this.isBusy) {
      return;
    }
    this.isBusy = true;
    try {
      openExternalUrl(await startCheckout(this.supabase, tier, interval));
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
      openExternalUrl(await openBillingPortalUrl(this.supabase));
      this.close();
      this.onCheckoutOpened();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
}
