import {
  App,
  Notice,
  PluginSettingTab,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
import { WEB_APP_URL } from "../constants";
import type InohPlugin from "../main";
import { isPaidTier, TIER_DISPLAY_NAMES } from "../subscriptions";
import { openExternalUrl } from "../ui";
import { registerAppIcons } from "./app-icons";
import { appsDefinitions } from "./apps-definitions";
import { AuthModal } from "./auth-modal";

export class InohSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InohPlugin,
  ) {
    super(app, plugin);
    registerAppIcons();
    // Scopes the plugin's settings-only styles (hand cursor on buttons).
    this.containerEl.addClass("inoh-settings");
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Account",
        items: [
          this.getStartedDefinition(),
          this.signedInDefinition(),
          this.planDefinition(),
          this.emptyDeckDefinition(),
        ],
      },
      {
        type: "group",
        heading: "Highlighting",
        items: [
          {
            name: "Enable highlighting",
            desc: "Underline deck words in the editor as you write.",
            control: { type: "toggle", key: "highlightEnabled" },
          },
        ],
      },
      {
        type: "group",
        heading: "Apps",
        items: appsDefinitions(),
      },
    ];
  }

  override getControlValue(key: string): unknown {
    return key === "highlightEnabled" ? this.plugin.settings.highlightEnabled : undefined;
  }

  /** Routed through the plugin so the deck matcher rebuilds and data.json keeps its deck cache. */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key !== "highlightEnabled") {
      return;
    }
    this.plugin.settings.highlightEnabled = value === true;
    await this.plugin.saveSettings();
  }

  /**
   * Re-reads the definitions and repaints.
   *
   * Row `name` and `desc` are plain values, captured when the definitions are
   * built — only `visible` is re-evaluated per render. So every async change
   * behind the tab (sign-in, deck sync, plan lookup) has to call this, or the
   * rows keep showing whatever was true at startup: "Signed in" instead of the
   * email, "Deck not synced yet" after a sync, "Free plan" for a subscriber.
   *
   * Reason: on 1.13+ `display()` does not refresh declaratively rendered
   * settings — `update()` is the only thing that does.
   */
  refresh(): void {
    this.update();
  }

  /**
   * Reloads everything shown in the Account group: deck, plan, username.
   * Used on sign-in and by the Refresh button — one deliberately covers the
   * other, so "I refreshed but it still shows the old plan" cannot happen.
   * Repaints once immediately so rows flip, then again once both loads land.
   */
  private async reloadAccountState(): Promise<void> {
    this.refresh();
    await Promise.all([this.plugin.refreshDeck(), this.plugin.account.refresh()]);
    this.refresh();
  }

  private isSignedOut(): boolean {
    return !this.plugin.currentUserEmail;
  }

  private getStartedDefinition(): SettingDefinition {
    return {
      name: "Get started",
      desc: createFragment((fragment) => {
        fragment.appendText(
          "Sign in with your email — entering a new email creates an Inoh account automatically. ",
        );
        fragment.appendText("You build your vocabulary deck at ");
        fragment.createEl("a", { text: "inoh.app", href: WEB_APP_URL });
        fragment.appendText(" and this plugin brings it into your notes.");
      }),
      visible: () => this.isSignedOut(),
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText("Sign in or sign up")
            .setCta()
            .onClick(() => {
              new AuthModal(this.app, this.plugin.supabase, () => {
                void this.reloadAccountState();
              }).open();
            }),
        );
      },
    };
  }

  private signedInDefinition(): SettingDefinition {
    const { account, currentUserEmail } = this.plugin;
    const cardCount = this.plugin.deckService.getCards().length;
    const fetchedAt = this.plugin.deckService.getFetchedAt();

    // Accounts are created by email OTP, so a display name is optional — fall
    // back to the email rather than showing a nameless row.
    const accountDetails = [
      account.username ? currentUserEmail : null,
      `${cardCount} ${cardCount === 1 ? "word" : "words"}`,
      fetchedAt ? `synced ${new Date(fetchedAt).toLocaleString()}` : "not synced yet",
    ].filter(Boolean);

    return {
      name: account.username ?? currentUserEmail ?? "Signed in",
      desc: accountDetails.join(" · "),
      visible: () => !this.isSignedOut(),
      render: (setting) => {
        setting.addButton((button) =>
          button.setButtonText("Refresh").onClick(() => void this.reloadAccountState()),
        );
        setting.addButton((button) => {
          // Obsidian's destructive buttons get no hover feedback; dim on hover.
          button.buttonEl.addClass("inoh-hover-dim");
          return button
            .setButtonText("Sign out")
            .setDestructive()
            .onClick(async () => {
              try {
                await this.plugin.signOut();
              } catch (error) {
                new Notice(error instanceof Error ? error.message : String(error));
              }
              this.refresh();
            });
        });
      },
    };
  }

  private planDefinition(): SettingDefinition {
    const { tier, hasLiveStripeSubscription } = this.plugin.account.subscription;
    // Mirrors the Inoh app: a live-but-unhealthy subscription (past_due) is not
    // entitled to a paid plan, but still needs the portal to fix its card.
    const canManageBilling = isPaidTier(tier) || hasLiveStripeSubscription;

    return {
      name: isPaidTier(tier) ? `Inoh ${TIER_DISPLAY_NAMES[tier]}` : "Free plan",
      desc: this.planDescription(),
      visible: () => !this.isSignedOut(),
      render: (setting) => {
        if (this.plugin.account.subscriptionCheckFailed) {
          setting.addButton((button) =>
            button.setButtonText("Retry").onClick(async () => {
              await this.plugin.account.refresh();
              this.refresh();
            }),
          );
          return;
        }
        if (canManageBilling) {
          setting.addButton((button) =>
            // Reason: returning the promise makes ButtonComponent show its own
            // spinner (mod-loading) and swallow clicks until Stripe answers.
            button.setButtonText("Manage").onClick(() => this.plugin.account.openBillingPortal()),
          );
          return;
        }
        setting.addButton((button) =>
          button
            .setButtonText("Upgrade")
            .setCta()
            .onClick(() => {
              this.plugin.account.promptUpgrade(null);
            }),
        );
      },
    };
  }

  /**
   * Quotas and prices are owned server-side, so no number is quoted here —
   * the upgrade modal reads live prices and the apps name a limit when it is
   * actually hit.
   */
  private planDescription(): string {
    const { tier, cancelAtPeriodEnd, currentPeriodEnd } = this.plugin.account.subscription;
    if (this.plugin.account.subscriptionCheckFailed) {
      return "Could not check your plan. If you subscribed, this is not your real plan.";
    }
    if (!isPaidTier(tier)) {
      return "";
    }
    if (cancelAtPeriodEnd && currentPeriodEnd) {
      const lapseDate = new Date(currentPeriodEnd).toLocaleDateString();
      return `Cancels on ${lapseDate} — you keep ${TIER_DISPLAY_NAMES[tier]} until then.`;
    }
    return "";
  }

  private emptyDeckDefinition(): SettingDefinition {
    return {
      name: "Your deck is empty",
      // Suggestions are disabled until their quality improves — the original
      // copy mentioning them is kept below for when they return.
      // desc:
      //   "Add words to your deck in the Inoh app, then hit Refresh. " +
      //   "Highlighting and suggestions start working once your deck has words.",
      desc:
        "Add words to your deck in the Inoh app, then hit Refresh. " +
        "Highlighting starts working once your deck has words.",
      visible: () => !this.isSignedOut() && this.plugin.deckService.getCards().length === 0,
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText("Open inoh.app")
            .setCta()
            .onClick(() => {
              openExternalUrl(WEB_APP_URL);
            }),
        );
      },
    };
  }
}
