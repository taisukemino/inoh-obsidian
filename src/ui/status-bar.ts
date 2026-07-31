import type InohPlugin from "../main";

/**
 * Status-bar item cycling through the plugin's states:
 * "Inoh: sign in" → "Inoh: syncing…" → "Inoh: N words" (or "add words").
 * Click refreshes the deck (or opens settings when signed out / deck empty).
 */
export class StatusBar {
  constructor(
    private readonly plugin: InohPlugin,
    private readonly element: HTMLElement,
  ) {
    element.addClass("mod-clickable");
    element.onClickEvent(() => {
      const hasWords = this.plugin.deckService.getCards().length > 0;
      if (this.plugin.currentUserEmail && hasWords) {
        void this.plugin.refreshDeck();
      } else {
        // Signed out or empty deck: settings has the sign-in / add-words guide.
        this.openPluginSettings();
      }
    });
    this.update();
  }

  update(): void {
    if (!this.plugin.currentUserEmail) {
      this.element.setText("Inoh: sign in");
      return;
    }
    if (this.plugin.deckService.isRefreshing) {
      this.element.setText("Inoh: syncing…");
      return;
    }
    const cardCount = this.plugin.deckService.getCards().length;
    if (cardCount === 0) {
      this.element.setText("Inoh: add words");
      return;
    }
    this.element.setText(`Inoh: ${cardCount} ${cardCount === 1 ? "word" : "words"}`);
  }

  private openPluginSettings(): void {
    // `app.setting` is not in the public typings but is the standard way
    // plugins open their own settings tab.
    const appWithSettings = this.plugin.app as unknown as {
      setting: { open(): void; openTabById(id: string): void };
    };
    appWithSettings.setting.open();
    appWithSettings.setting.openTabById("inoh");
  }
}
