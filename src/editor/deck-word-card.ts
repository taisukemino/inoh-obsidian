import { setIcon } from "obsidian";
import { WEB_APP_URL } from "../constants";
import { AUDIO_BUCKET_URL } from "../supabase/config";
import type { DeckCard } from "../types";

export type DeckWordCardOptions = {
  /** Removes the card from the deck; resolves true when it was removed. */
  onRemove: (card: DeckCard) => Promise<boolean>;
  /** Runs after a successful remove — e.g. to close the mobile modal. */
  afterRemove?: () => void;
};

/**
 * Renders a deck card: word (linked to the web app), pronunciation audio,
 * phonetic, definition, example, card state, and a remove action.
 *
 * Shared by the desktop hover tooltip and the mobile tap modal, so both
 * surfaces show exactly the same content.
 */
export function renderDeckWordCard(card: DeckCard, options: DeckWordCardOptions): HTMLElement {
  const { dictionary } = card;
  const root = createDiv({ cls: "inoh-tooltip" });

  const header = root.createDiv({ cls: "inoh-tooltip-header" });
  header.createEl("a", {
    cls: "inoh-tooltip-word",
    text: dictionary.word,
    href: `${WEB_APP_URL}/word/${dictionary.id}`,
    attr: { target: "_blank", rel: "noopener", "aria-label": "Open in the Inoh web app" },
  });
  if (dictionary.word_audio_path) {
    const audioButton = header.createEl("button", {
      cls: "inoh-tooltip-audio clickable-icon",
      attr: { "aria-label": "Play pronunciation" },
    });
    setIcon(audioButton, "volume-2");
    const audioUrl = `${AUDIO_BUCKET_URL}/${dictionary.word_audio_path}`;
    audioButton.addEventListener("click", (event) => {
      event.preventDefault();
      void new Audio(audioUrl).play().catch((error) => {
        console.error("Inoh: could not play word audio", error);
      });
    });
  }
  if (dictionary.phonetic) {
    header.createSpan({ cls: "inoh-tooltip-phonetic", text: `/${dictionary.phonetic}/` });
  }

  root.createDiv({ cls: "inoh-tooltip-definition", text: dictionary.definition });
  if (dictionary.example_sentence) {
    root.createDiv({ cls: "inoh-tooltip-example", text: dictionary.example_sentence });
  }
  const footer = root.createDiv({ cls: "inoh-tooltip-footer" });
  footer.appendChild(buildRemoveButton(card, options));

  return root;
}

/** "Remove from deck" text button; the caller surfaces errors as Notices. */
function buildRemoveButton(card: DeckCard, options: DeckWordCardOptions): HTMLElement {
  const removeButton = createEl("button", {
    cls: "inoh-tooltip-remove",
    text: "Remove from deck",
    attr: { "aria-label": `Remove "${card.dictionary.word}" from your deck` },
  });
  removeButton.addEventListener("click", () => {
    removeButton.disabled = true;
    removeButton.setText("Removing…");
    void options.onRemove(card).then((wasRemoved) => {
      if (wasRemoved) {
        removeButton.setText("Removed");
        options.afterRemove?.();
        return;
      }
      removeButton.disabled = false;
      removeButton.setText("Remove from deck");
    });
  });
  return removeButton;
}
