import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, tooltips } from "@codemirror/view";
import type { DeckWordSuggestion } from "../suggestions/suggestion-service";

/** A suggestion anchored to a live document range. */
export type ActiveSuggestion = {
  id: number;
  from: number;
  to: number;
  suggestion: DeckWordSuggestion;
};

let nextSuggestionId = 0;

/** Replaces the editor's pending suggestions (dispatched after a request). */
export const setSuggestionsEffect = StateEffect.define<ActiveSuggestion[]>();
/** Removes one suggestion by id (after Apply or Dismiss). */
export const dismissSuggestionEffect = StateEffect.define<number>();
/** Removes every pending suggestion. */
export const clearSuggestionsEffect = StateEffect.define<null>();

const suggestionMark = Decoration.mark({ class: "inoh-suggestion-phrase" });

/**
 * Holds the pending suggestions for one editor and decorates their phrases.
 * Ranges are remapped through document changes, so suggestions survive edits
 * elsewhere in the note; a range the user edits away is dropped.
 */
export const suggestionField = StateField.define<ActiveSuggestion[]>({
  create: () => [],
  update(suggestions, transaction) {
    let next = suggestions;
    if (transaction.docChanged) {
      next = next
        .map((active) => ({
          ...active,
          from: transaction.changes.mapPos(active.from, 1),
          to: transaction.changes.mapPos(active.to, -1),
        }))
        .filter((active) => active.from < active.to);
    }
    for (const effect of transaction.effects) {
      if (effect.is(setSuggestionsEffect)) {
        next = effect.value;
      } else if (effect.is(dismissSuggestionEffect)) {
        next = next.filter((active) => active.id !== effect.value);
      } else if (effect.is(clearSuggestionsEffect)) {
        next = [];
      }
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (suggestions) =>
      Decoration.set(
        suggestions.map((active) => suggestionMark.range(active.from, active.to)),
        true,
      ),
    ),
});

/**
 * Anchors each suggestion's original phrase to a document range. Searches the
 * selection the suggestions were requested for first, then the whole note as
 * a fallback; suggestions whose phrase no longer exists are skipped.
 */
export function resolveSuggestionRanges(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
  suggestions: DeckWordSuggestion[],
): ActiveSuggestion[] {
  const resolved: ActiveSuggestion[] = [];
  for (const suggestion of suggestions) {
    let from = documentText.indexOf(suggestion.original, selectionFrom);
    if (from === -1 || from >= selectionTo) {
      from = documentText.indexOf(suggestion.original);
    }
    if (from === -1) {
      continue;
    }
    resolved.push({
      id: nextSuggestionId++,
      from,
      to: from + suggestion.original.length,
      suggestion,
    });
  }
  return resolved;
}

/** Builds the hover tooltip with Apply / Dismiss actions for a marked phrase. */
export function buildSuggestionTooltip(): Extension {
  // Reason: CodeMirror positions tooltips absolutely inside the editor pane
  // by default, so a wide tooltip near the pane edge is clipped by the
  // sidebar. Fixed positioning escapes the pane's overflow clipping and lets
  // CodeMirror keep the tooltip inside the window instead.
  const tooltipPositioning = tooltips({ position: "fixed" });
  const suggestionHoverTooltip = hoverTooltip(
    (view, pos) => {
      const active = view.state
        .field(suggestionField)
        .find((candidate) => candidate.from <= pos && pos <= candidate.to);
      if (!active) {
        return null;
      }
      return {
        pos: active.from,
        end: active.to,
        above: true,
        create: () => ({ dom: renderSuggestionTooltip(view, active) }),
      };
    },
    { hoverTime: 150 },
  );
  return [tooltipPositioning, suggestionHoverTooltip];
}

function renderSuggestionTooltip(view: EditorView, active: ActiveSuggestion): HTMLElement {
  const { suggestion } = active;
  const root = createDiv({ cls: "inoh-tooltip" });

  root.createDiv({ cls: "inoh-suggestion-word", text: suggestion.word });
  if (suggestion.definition) {
    root.createDiv({ cls: "inoh-tooltip-definition", text: suggestion.definition });
  }

  const diff = root.createDiv({ cls: "inoh-suggestion-diff" });
  diff.createSpan({ cls: "inoh-suggestion-original", text: suggestion.original });
  diff.createSpan({ text: " → " });
  diff.createSpan({ cls: "inoh-suggestion-replacement", text: suggestion.replacement });

  if (suggestion.explanation) {
    root.createDiv({ cls: "inoh-suggestion-explanation", text: suggestion.explanation });
  }

  const buttons = root.createDiv({ cls: "inoh-suggestion-buttons" });

  const applyButton = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
  applyButton.addEventListener("click", () => {
    // Re-read the range: edits since the tooltip opened may have moved it.
    const current = view.state
      .field(suggestionField)
      .find((candidate) => candidate.id === active.id);
    if (!current) {
      return;
    }
    view.dispatch({
      changes: { from: current.from, to: current.to, insert: suggestion.replacement },
      effects: dismissSuggestionEffect.of(active.id),
    });
  });

  const dismissButton = buttons.createEl("button", { text: "Dismiss" });
  dismissButton.addEventListener("click", () => {
    view.dispatch({ effects: dismissSuggestionEffect.of(active.id) });
  });

  if (view.state.field(suggestionField).length > 1) {
    const dismissAllButton = buttons.createEl("button", { text: "Dismiss all" });
    dismissAllButton.addEventListener("click", () => {
      view.dispatch({ effects: clearSuggestionsEffect.of(null) });
    });
  }

  return root;
}
