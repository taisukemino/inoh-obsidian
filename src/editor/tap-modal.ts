import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { App, Modal } from "obsidian";
import type { DeckCard } from "../types";
import { renderDeckWordCard } from "./deck-word-card";
import { renderSuggestionCard } from "./suggestion-card";
import { suggestionField } from "./suggestion-extension";
import type { InohHighlighterPlugin } from "./highlight-extension";

/**
 * iOS dispatches synthesized mouse events (mousedown/mouseup/click) a beat
 * after the touch that closed a modal. By then the modal is gone, so they
 * land on the editor underneath — focusing it (keyboard pops up), placing the
 * cursor, and re-opening the card when the close button happened to sit over
 * a highlighted word. Every editor mouse event inside this window after a
 * close is that ghost and gets swallowed.
 */
const GHOST_CLICK_WINDOW_MS = 500;
let lastCardModalClosedAt = 0;

function swallowGhostEventAfterClose(event: MouseEvent): boolean {
  if (Date.now() - lastCardModalClosedAt >= GHOST_CLICK_WINDOW_MS) {
    return false;
  }
  event.preventDefault();
  return true;
}

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
    // Closing must not hand focus back to the editor: restoring the selection
    // scrolls the note to the cursor and pops the on-screen keyboard.
    this.shouldRestoreSelection = false;
  }

  override onOpen(): void {
    this.modalEl.addClass("inoh-modal");
    // Remove from the DOM rather than hide with CSS: on mobile the close
    // button is rendered outside modalEl, where .inoh-modal-scoped rules
    // never match. Tapping outside the card closes the modal.
    this.containerEl.querySelector(".modal-close-button")?.remove();
    this.buildContent(this.contentEl, () => this.close());
  }

  override onClose(): void {
    lastCardModalClosedAt = Date.now();
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
 * @param onRemoveCard - Removes the card from the deck; resolves true on success
 */
export function buildTapToOpenCards(
  app: App,
  highlighterPlugin: InohHighlighterPlugin,
  onRemoveCard: (card: DeckCard) => Promise<boolean>,
): Extension {
  return EditorView.domEventHandlers({
    mousedown: swallowGhostEventAfterClose,
    mouseup: swallowGhostEventAfterClose,
    click: (event, view) => {
      if (swallowGhostEventAfterClose(event)) {
        return true;
      }
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
        new EditorCardModal(app, (containerEl, close) => {
          containerEl.appendChild(
            renderDeckWordCard(match.card, { onRemove: onRemoveCard, afterRemove: close }),
          );
        }).open();
      }
      // Never claim the event: the tap should still place the cursor.
      return false;
    },
  });
}
