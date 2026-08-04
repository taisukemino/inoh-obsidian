import type { EditorView } from "@codemirror/view";
import { dismissSuggestionEffect, suggestionField } from "./suggestion-extension";

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
