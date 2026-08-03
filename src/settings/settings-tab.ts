import {
  App,
  Notice,
  PluginSettingTab,
  setIcon,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
import { DISCOVER_URL, RAYCAST_EXTENSION_URL, WEB_APP_URL } from "../constants";
import type InohPlugin from "../main";
import { APP_ICON_IDS, registerAppIcons } from "./app-icons";
import { AuthModal } from "./auth-modal";

export class InohSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InohPlugin,
  ) {
    super(app, plugin);
    registerAppIcons();
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
          this.discoverWordsDefinition(),
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
        items: this.appsDefinitions(),
      },
    ];
  }

  /**
   * Cross-promotion rows for the other Inoh ecosystem apps (this plugin
   * excluded). The icon + name itself is the link — no separate button. Apps
   * without a `url` are unreleased — the iOS App Store listing is mid-rebrand
   * and the Chrome extension is not on the Web Store yet — so they get a muted
   * non-clickable "Coming soon" label instead.
   */
  private appsDefinitions(): SettingDefinition[] {
    const apps: { name: string; icon: string; url?: string }[] = [
      { name: "iOS app", icon: APP_ICON_IDS.apple },
      { name: "Web app", icon: "globe", url: WEB_APP_URL },
      { name: "Chrome extension", icon: APP_ICON_IDS.chrome },
      { name: "Raycast extension", icon: APP_ICON_IDS.raycast, url: RAYCAST_EXTENSION_URL },
    ];
    return apps.map(({ name, icon, url }) => ({
      name,
      render: (setting) => {
        const iconElement = setting.nameEl.createSpan({ cls: "inoh-app-icon" });
        setIcon(iconElement, icon);
        setting.nameEl.prepend(iconElement);
        if (url) {
          setting.nameEl.addClass("inoh-app-name-link");
          setting.nameEl.setAttribute("role", "link");
          setting.nameEl.addEventListener("click", () => {
            window.open(url);
          });
        } else {
          setting.controlEl.createSpan({ cls: "inoh-coming-soon", text: "Coming soon" });
        }
      },
    }));
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
    await Promise.all([this.plugin.refreshDeck(), this.plugin.refreshAccountState()]);
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
    const { currentUsername, currentUserEmail } = this.plugin;
    const cardCount = this.plugin.deckService.getCards().length;
    const fetchedAt = this.plugin.deckService.getFetchedAt();

    // Accounts are created by email OTP, so a display name is optional — fall
    // back to the email rather than showing a nameless row.
    const accountDetails = [
      currentUsername ? currentUserEmail : null,
      `${cardCount} ${cardCount === 1 ? "word" : "words"}`,
      fetchedAt ? `synced ${new Date(fetchedAt).toLocaleString()}` : "not synced yet",
    ].filter(Boolean);

    return {
      name: currentUsername ?? currentUserEmail ?? "Signed in",
      desc: accountDetails.join(" · "),
      visible: () => !this.isSignedOut(),
      render: (setting) => {
        setting.addButton((button) =>
          button.setButtonText("Refresh").onClick(() => void this.reloadAccountState()),
        );
        setting.addButton((button) =>
          button
            .setButtonText("Sign out")
            .setDestructive()
            .onClick(async () => {
              try {
                await this.plugin.signOut();
              } catch (error) {
                new Notice(error instanceof Error ? error.message : String(error));
              }
              this.refresh();
            }),
        );
      },
    };
  }

  private planDefinition(): SettingDefinition {
    const { isPro, hasLiveStripeSubscription } = this.plugin.subscription;
    // Mirrors the Inoh app: a live-but-unhealthy subscription (past_due) is not
    // entitled to Pro, but still needs the portal to fix its card.
    const canManageBilling = isPro || hasLiveStripeSubscription;

    return {
      name: isPro ? "Inoh Pro" : "Free plan",
      desc: this.planDescription(),
      visible: () => !this.isSignedOut(),
      render: (setting) => {
        if (this.plugin.subscriptionCheckFailed) {
          setting.addButton((button) =>
            button.setButtonText("Retry").onClick(async () => {
              await this.plugin.refreshAccountState();
              this.refresh();
            }),
          );
          return;
        }
        if (canManageBilling) {
          setting.addButton((button) =>
            button.setButtonText("Manage").onClick(() => {
              void this.plugin.openBillingPortal();
            }),
          );
          return;
        }
        setting.addButton((button) =>
          button
            .setButtonText("Upgrade to Pro")
            .setCta()
            .onClick(() => {
              this.plugin.promptUpgrade(null);
            }),
        );
      },
    };
  }

  /**
   * The daily cap is set server-side, so no number is quoted — the limit
   * message names it when you actually hit it.
   */
  private planDescription(): string {
    const { isPro, cancelAtPeriodEnd, currentPeriodEnd } = this.plugin.subscription;
    if (this.plugin.subscriptionCheckFailed) {
      return "Could not check your plan. If you subscribed, this is not your real plan.";
    }
    if (!isPro) {
      return "A limited number of suggestion requests a day.";
    }
    if (cancelAtPeriodEnd && currentPeriodEnd) {
      const lapseDate = new Date(currentPeriodEnd).toLocaleDateString();
      return `Unlimited suggestions. Cancels on ${lapseDate} — you keep Pro until then.`;
    }
    return "Unlimited suggestions.";
  }

  /** Own row below the signed-in one; the empty-deck row has its own CTA, so this hides then. */
  private discoverWordsDefinition(): SettingDefinition {
    return {
      name: "Discover words",
      desc: "Browse words and add them to your deck in the Inoh app.",
      visible: () => !this.isSignedOut() && this.plugin.deckService.getCards().length > 0,
      render: (setting) => {
        setting.addButton((button) =>
          button.setButtonText("Open inoh.app").onClick(() => {
            window.open(DISCOVER_URL);
          }),
        );
      },
    };
  }

  private emptyDeckDefinition(): SettingDefinition {
    return {
      name: "Your deck is empty",
      desc:
        "Add words to your deck in the Inoh app, then hit Refresh. " +
        "Highlighting and suggestions start working once your deck has words.",
      visible: () => !this.isSignedOut() && this.plugin.deckService.getCards().length === 0,
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText("Open inoh.app")
            .setCta()
            .onClick(() => {
              window.open(DISCOVER_URL);
            }),
        );
      },
    };
  }
}
