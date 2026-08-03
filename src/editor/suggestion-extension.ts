import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
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

