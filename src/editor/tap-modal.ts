import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { App, Modal } from "obsidian";
import { renderDeckWordCard } from "./deck-word-card";
import { renderSuggestionCard } from "./suggestion-card";
import { suggestionField } from "./suggestion-extension";
import type { InohHighlighterPlugin } from "./highlight-extension";

/**
 * Shows one editor card — a deck word or a suggestion — in a modal. Modals are
 * the touch stand-in for hover tooltips: same rendered content, but reachable
 * with a tap and dismissable with the standard close affordances.
 */
class EditorCardModal extends Modal {
  constructor(
    app: App,
    private readonly buildContent: (containerEl: HTMLElement, close: () => void) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("inoh-modal");
    this.buildContent(this.contentEl, () => this.close());
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Editor extension that opens the deck-word / suggestion cards on tap.
 *
 * Registered only on mobile: there is no hover on touch, so without this the
 * highlights are visible but inert — a user can run the suggest command and
 * then have no way to apply anything. Desktop keeps hover tooltips and its
 * click behaviour untouched by never registering this.
 *
 * @param app - Used to open the modal
 * @param highlighterPlugin - Source of the deck-word matches (no second scan)
 */
export function buildTapToOpenCards(
  app: App,
  highlighterPlugin: InohHighlighterPlugin,
): Extension {
  return EditorView.domEventHandlers({
    click: (event, view) => {
      const tappedPosition = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (tappedPosition === null) {
        return false;
      }

      // Suggestions win over deck-word highlights: they overlap when a deck
      // word sits inside a suggested phrase, and the suggestion is the one
      // with actions attached.
      const activeSuggestion = view.state
        .field(suggestionField)
        .find((candidate) => candidate.from <= tappedPosition && tappedPosition <= candidate.to);
      if (activeSuggestion) {
        new EditorCardModal(app, (containerEl, close) => {
          containerEl.appendChild(renderSuggestionCard(view, activeSuggestion, close));
        }).open();
        return false;
      }

      const highlighter = view.plugin(highlighterPlugin);
      const match = highlighter?.matches.find(
        (candidate) => candidate.from <= tappedPosition && tappedPosition <= candidate.to,
      );
      if (match) {
        new EditorCardModal(app, (containerEl) => {
          containerEl.appendChild(renderDeckWordCard(match.card));
        }).open();
      }
      // Never claim the event: the tap should still place the cursor.
      return false;
    },
  });
}
