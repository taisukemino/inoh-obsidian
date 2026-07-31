import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type InohPlugin from "../main";
import type { HighlightStyle, LlmProvider } from "../types";
import { AuthModal } from "./auth-modal";

export class InohSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InohPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.renderAccountSection();
    this.renderDeckSection();
    this.renderHighlightSection();
    this.renderAiPlaceholderSection();
  }

  private renderAccountSection(): void {
    new Setting(this.containerEl).setName("Account").setHeading();

    if (!this.plugin.currentUserEmail) {
      new Setting(this.containerEl)
        .setName("Not signed in")
        .setDesc("Sign in with your Inoh account to load your deck.")
        .addButton((button) =>
          button
            .setButtonText("Sign in")
            .setCta()
            .onClick(() => {
              new AuthModal(this.app, this.plugin.supabase, () => {
                void this.plugin.refreshDeck();
                this.display();
              }).open();
            }),
        );
      return;
    }

    const fetchedAt = this.plugin.deckService.getFetchedAt();
    const lastSynced = fetchedAt
      ? `Deck last synced ${new Date(fetchedAt).toLocaleString()}.`
      : "Deck not synced yet.";

    new Setting(this.containerEl)
      .setName(this.plugin.currentUserEmail)
      .setDesc(lastSynced)
      .addButton((button) =>
        button.setButtonText("Refresh deck").onClick(async () => {
          await this.plugin.refreshDeck();
          this.display();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("Sign out")
          .setWarning()
          .onClick(async () => {
            try {
              await this.plugin.signOut();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : String(error));
            }
            this.display();
          }),
      );
  }

  private renderDeckSection(): void {
    new Setting(this.containerEl).setName("Deck").setHeading();

    new Setting(this.containerEl)
      .setName("Highlight words from")
      .setDesc("Limit highlighting to one deck, or match against all of them.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "All decks");
        for (const deck of this.plugin.deckService.getDecks()) {
          dropdown.addOption(deck.id, deck.name);
        }
        dropdown.setValue(this.plugin.settings.selectedDeckId ?? "");
        dropdown.onChange(async (value) => {
          this.plugin.settings.selectedDeckId = value || null;
          await this.plugin.saveSettings();
        });
      });
  }

  private renderHighlightSection(): void {
    new Setting(this.containerEl).setName("Highlighting").setHeading();

    new Setting(this.containerEl)
      .setName("Enable highlighting")
      .setDesc("Underline deck words in the editor as you write.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.highlightEnabled).onChange(async (value) => {
          this.plugin.settings.highlightEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(this.containerEl)
      .setName("Highlight style")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("underline", "Dotted underline")
          .addOption("background", "Background tint")
          .setValue(this.plugin.settings.highlightStyle)
          .onChange(async (value) => {
            this.plugin.settings.highlightStyle = value as HighlightStyle;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(this.containerEl)
      .setName("Tolerant matching")
      .setDesc("Also match typo-level spellings of deck words. May over-match while typing.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.tolerantMatching).onChange(async (value) => {
          this.plugin.settings.tolerantMatching = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderAiPlaceholderSection(): void {
    new Setting(this.containerEl).setName("AI suggestions (coming soon)").setHeading();

    new Setting(this.containerEl)
      .setName("Provider")
      .setDesc("Phase 2: suggest deck words when you write a plain synonym.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("anthropic", "Anthropic")
          .addOption("openai", "OpenAI")
          .addOption("gemini", "Gemini")
          .setValue(this.plugin.settings.llmProvider)
          .setDisabled(true)
          .onChange(async (value) => {
            this.plugin.settings.llmProvider = value as LlmProvider;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(this.containerEl)
      .setName("API key")
      .setDesc("Bring your own key. Not used yet.")
      .addText((text) => {
        text.setPlaceholder("sk-…").setValue(this.plugin.settings.llmApiKey).setDisabled(true);
      });
  }
}
