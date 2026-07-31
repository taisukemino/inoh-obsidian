import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import { setIcon } from "obsidian";
import { AUDIO_BUCKET_URL, WEB_APP_URL } from "../constants";
import type { DeckCard } from "../types";
import type { InohHighlighterPlugin } from "./highlight-extension";

/**
 * Builds the hover tooltip that shows a deck card when the pointer rests on a
 * highlighted word. Reads matches straight off the highlighter view plugin,
 * so there is no second scan.
 */
export function buildHoverTooltip(highlighterPlugin: InohHighlighterPlugin): Extension {
  return hoverTooltip(
    (view, pos) => {
      const highlighter = view.plugin(highlighterPlugin);
      const match = highlighter?.matches.find((m) => m.from <= pos && pos <= m.to);
      if (!match) {
        return null;
      }

      return {
        pos: match.from,
        end: match.to,
        above: true,
        create: () => ({ dom: renderCardTooltip(match.card) }),
      };
    },
    { hoverTime: 200 },
  );
}

function renderCardTooltip(card: DeckCard): HTMLElement {
  const { dictionary } = card;
  const root = document.createElement("div");
  root.className = "inoh-tooltip";

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
