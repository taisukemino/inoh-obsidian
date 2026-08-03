import { setIcon } from "obsidian";
import { WEB_APP_URL } from "../constants";
import { AUDIO_BUCKET_URL } from "../supabase/config";
import type { DeckCard } from "../types";

/**
 * Renders a deck card: word (linked to the web app), pronunciation audio,
 * phonetic, definition, example, and card state.
 *
 * Shared by the desktop hover tooltip and the mobile tap modal, so both
 * surfaces show exactly the same content.
 */
export function renderDeckWordCard(card: DeckCard): HTMLElement {
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
  root.createDiv({ cls: "inoh-tooltip-state", text: `Card state: ${card.card_state}` });

  return root;
}
