import type { EditorView } from "@codemirror/view";
import {
  clearSuggestionsEffect,
  dismissSuggestionEffect,
  suggestionField,
} from "./suggestion-extension";

/**
 * Applies one pending suggestion: replaces its phrase with the rewrite and
 * removes it from the pending set. Shared by the tooltip button, the mobile
 * modal, and the "Apply next suggestion" command.
 *
 * @param view - The editor holding the suggestion
 * @param suggestionId - Id from the suggestion field
 * @returns False when the suggestion no longer exists (edited away or stale id)
 */
export function applySuggestion(view: EditorView, suggestionId: number): boolean {
  // Re-read the range: edits since the UI opened may have moved or removed it.
  const current = view.state
    .field(suggestionField)
    .find((candidate) => candidate.id === suggestionId);
  if (!current) {
    return false;
  }
  view.dispatch({
    changes: { from: current.from, to: current.to, insert: current.suggestion.replacement },
    selection: { anchor: current.from + current.suggestion.replacement.length },
    effects: dismissSuggestionEffect.of(suggestionId),
    scrollIntoView: true,
  });
  return true;
}

/** Removes one pending suggestion without touching the text. */
export function dismissSuggestion(view: EditorView, suggestionId: number): void {
  view.dispatch({ effects: dismissSuggestionEffect.of(suggestionId) });
}

/** Removes every pending suggestion without touching the text. */
export function dismissAllSuggestions(view: EditorView): void {
  view.dispatch({ effects: clearSuggestionsEffect.of(null) });
}

/**
 * Picks the suggestion the "Apply next suggestion" command should act on:
 * the first one starting at or after the cursor, wrapping to the earliest in
 * the note when the cursor is past them all.
 *
 * @param suggestions - Pending suggestions, in any order
 * @param cursorPosition - Current cursor offset
 * @returns The suggestion to act on, or null when none are pending
 */
export function pickNextSuggestion<T extends { from: number }>(
  suggestions: readonly T[],
  cursorPosition: number,
): T | null {
  if (suggestions.length === 0) {
    return null;
  }
  const inDocumentOrder = [...suggestions].sort((a, b) => a.from - b.from);
  const atOrAfterCursor = inDocumentOrder.find(
    (suggestion) => suggestion.from >= cursorPosition,
  );
  return atOrAfterCursor ?? inDocumentOrder[0];
}
