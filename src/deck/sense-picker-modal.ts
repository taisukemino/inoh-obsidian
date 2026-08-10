import { Modal, type App } from "obsidian";
import type { DictionaryLookupEntry } from "../types";

/**
 * Lets the user pick one sense when the selected word has several dictionary
 * entries ("bank" the institution vs. "bank" the riverside), mirroring the
 * Chrome extension's sense picker. Adding an arbitrary sense would put the
 * wrong card in the deck.
 */
export class SensePickerModal extends Modal {
  constructor(
    app: App,
    private readonly word: string,
    private readonly entries: DictionaryLookupEntry[],
    private readonly onPick: (entry: DictionaryLookupEntry) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("inoh-modal");
    this.titleEl.setText(`"${this.word}" has several meanings`);
    this.contentEl.createEl("p", {
      text: "Pick the one to add to your deck:",
      cls: "inoh-sense-picker-hint",
    });

    for (const entry of this.entries) {
      const senseButton = this.contentEl.createEl("button", { cls: "inoh-sense-option" });
      senseButton.createEl("strong", { text: entry.word });
      senseButton.createSpan({ text: ` — ${entry.definition}` });
      senseButton.addEventListener("click", () => {
        // Reason: close() must come first — onPick shows Notices, and a still
        // open modal on mobile would sit on top of them.
        this.close();
        this.onPick(entry);
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
