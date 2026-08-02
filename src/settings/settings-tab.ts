import {
  App,
  Notice,
  PluginSettingTab,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
import { DISCOVER_URL, WEB_APP_URL } from "../constants";
import type InohPlugin from "../main";
import { AuthModal } from "./auth-modal";

export class InohSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InohPlugin,
  ) {
    super(app, plugin);
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
   * Re-reads the definitions and repaints. Row names and visibility depend on
   * auth and deck state, so sign-in, sign-out, and deck refresh all call this.
   * Reason: on 1.13+ `display()` does not refresh declaratively rendered
   * settings — `update()` is the only thing that does.
   */
  private refresh(): void {
    this.update();
  }

  /**
   * Signing in changes the deck, the plan, and which rows are visible. Repaints
   * once immediately so the rows flip, then again once both loads land.
   */
  private async reloadAccountState(): Promise<void> {
    this.refresh();
    await Promise.all([this.plugin.refreshDeck(), this.plugin.refreshProStatus()]);
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
    const fetchedAt = this.plugin.deckService.getFetchedAt();

    return {
      name: this.plugin.currentUserEmail ?? "Signed in",
      desc: fetchedAt
        ? `Deck last synced ${new Date(fetchedAt).toLocaleString()}.`
        : "Deck not synced yet.",
      visible: () => !this.isSignedOut(),
      render: (setting) => {
        setting.addButton((button) =>
          button.setButtonText("Refresh deck").onClick(async () => {
            await this.plugin.refreshDeck();
            this.refresh();
          }),
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
        "Add words to your deck in the Inoh app, then hit Refresh deck. " +
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
