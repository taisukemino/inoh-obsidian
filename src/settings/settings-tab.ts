import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { WEB_APP_URL } from "../constants";
import type InohPlugin from "../main";
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
    this.renderHighlightSection();
  }

  private renderAccountSection(): void {
    new Setting(this.containerEl).setName("Account").setHeading();

    if (!this.plugin.currentUserEmail) {
      new Setting(this.containerEl)
        .setName("Get started")
        .setDesc(
          createFragment((fragment) => {
            fragment.appendText(
              "Sign in with your email — entering a new email creates an Inoh account automatically. ",
            );
            fragment.appendText("You build your vocabulary deck at ");
            fragment.createEl("a", { text: "inoh.app", href: WEB_APP_URL });
            fragment.appendText(" and this plugin brings it into your notes.");
          }),
        )
        .addButton((button) =>
          button
            .setButtonText("Sign in or sign up")
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

    if (this.plugin.deckService.getCards().length === 0) {
      new Setting(this.containerEl)
        .setName("Your deck is empty")
        .setDesc(
          "Add words to your deck in the Inoh app, then hit Refresh deck. " +
            "Highlighting and suggestions start working once your deck has words.",
        )
        .addButton((button) =>
          button
            .setButtonText("Open inoh.app")
            .setCta()
            .onClick(() => {
              window.open(WEB_APP_URL);
            }),
        );
    }
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
  }

}
