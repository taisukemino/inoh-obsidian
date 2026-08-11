import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { showTooltip, ViewPlugin, type EditorView, type Tooltip } from "@codemirror/view";

/**
 * Floating "＋ Add to Inoh" button that appears above a selected word, the
 * Obsidian counterpart of the Chrome extension's in-page selection button.
 *
 * Desktop-only: on mobile the native selection callout sits exactly where
 * this tooltip would, and long-press already offers "Add to Inoh deck" in
 * the editor menu.
 */

/** Selections still change while the mouse drags; show only once they settle. */
const SELECTION_SETTLE_MS = 300;

export type AddWordTooltipOptions = {
  /** Whether the button should appear for this selection (addable, signed in, not in deck). */
  shouldOfferWord: (selectedText: string) => boolean;
  /** Runs the add flow (lookup, sense picker, notices). */
  onAddWord: (selectedText: string) => void;
};

const setAddWordTooltipEffect = StateEffect.define<Tooltip | null>();

const addWordTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setAddWordTooltipEffect)) {
        return effect.value;
      }
    }
    // Any edit or new selection invalidates a shown button.
    return transaction.docChanged || transaction.selection ? null : tooltip;
  },
  provide: (field) => showTooltip.from(field),
});

function buildAddButtonTooltip(
  view: EditorView,
  from: number,
  to: number,
  selectedText: string,
  onAddWord: (selectedText: string) => void,
): Tooltip {
  return {
    pos: from,
    end: to,
    above: true,
    create: () => {
      const addButton = createEl("button", {
        cls: "inoh-add-word-button",
        text: "＋ Add to Inoh",
      });
      // Reason: mousedown would move the cursor and collapse the selection
      // before click fires, dismissing the button under the pointer.
      addButton.addEventListener("mousedown", (event) => event.preventDefault());
      addButton.addEventListener("click", () => {
        view.dispatch({ effects: setAddWordTooltipEffect.of(null) });
        onAddWord(selectedText);
      });
      return { dom: addButton };
    },
  };
}

/** Watches the selection and pops the add button once it settles on a word. */
function buildSelectionWatcher(options: AddWordTooltipOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      private settleTimer: number | null = null;

      constructor(private readonly view: EditorView) {}

      update(update: { selectionSet: boolean; docChanged: boolean }): void {
        if (!update.selectionSet && !update.docChanged) {
          return;
        }
        this.cancelPendingShow();
        if (!this.view.state.selection.main.empty) {
          this.settleTimer = window.setTimeout(() => this.showIfAddable(), SELECTION_SETTLE_MS);
        }
      }

      destroy(): void {
        this.cancelPendingShow();
      }

      private cancelPendingShow(): void {
        if (this.settleTimer !== null) {
          window.clearTimeout(this.settleTimer);
          this.settleTimer = null;
        }
      }

      private showIfAddable(): void {
        this.settleTimer = null;
        const { from, to } = this.view.state.selection.main;
        const selectedText = this.view.state.sliceDoc(from, to).trim();
        if (!selectedText || !options.shouldOfferWord(selectedText)) {
          return;
        }
        this.view.dispatch({
          effects: setAddWordTooltipEffect.of(
            buildAddButtonTooltip(this.view, from, to, selectedText, options.onAddWord),
          ),
        });
      }
    },
  );
}

/**
 * Builds the selection add-button extension.
 *
 * @param options - Gate and action callbacks, wired to the plugin in main.ts
 */
export function buildAddWordTooltip(options: AddWordTooltipOptions): Extension {
  return [addWordTooltipField, buildSelectionWatcher(options)];
}
