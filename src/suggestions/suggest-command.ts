import { MarkdownView, Notice, Platform, type App } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeckService } from "../deck";
import { getEditorView, resolveSuggestionRanges, setSuggestionsEffect } from "../editor";
import type { AccountService } from "../subscriptions";
import { requestDeckWordSuggestions, SuggestionLimitError } from "./suggestion-service";

/** Server-side text limit (MAX_PARAGRAPH_LENGTH) in the suggest-deck-words edge function. */
const MAX_SUGGESTION_TEXT_LENGTH = 2_000;

/** What the suggest command needs from the plugin. */
export type SuggestionCommandHost = {
  app: App;
  supabase: SupabaseClient;
  currentUserEmail: string | null;
  deckService: Pick<DeckService, "getCards">;
  account: Pick<AccountService, "promptUpgrade">;
};

/** Blocks a second suggestion request; each one spends the daily free quota. */
let isSuggestionRequestInFlight = false;

/**
 * Command: ask the backend where the text could use a deck word.
 * Uses the selection when there is one, otherwise the entire note —
 * selecting text is fiddly on mobile, so the whole-note fallback keeps
 * the command usable there.
 *
 * @param host - The plugin, providing the session, deck, and upgrade prompt
 */
export async function suggestForSelectionOrNote(host: SuggestionCommandHost): Promise<void> {
  if (isSuggestionRequestInFlight) {
    new Notice("Inoh is already looking — hang on.");
    return;
  }
  const markdownView = host.app.workspace.getActiveViewOfType(MarkdownView);
  if (!markdownView?.file) {
    new Notice("Open a note first.");
    return;
  }
  if (!host.currentUserEmail) {
    new Notice("Sign in to Inoh first (plugin settings).");
    return;
  }
  const editor = markdownView.editor;
  const selectedText = editor.getSelection().trim();
  const hasSelection = selectedText.length > 0;
  const suggestionText = hasSelection ? selectedText : editor.getValue().trim();
  if (!suggestionText) {
    new Notice("This note is empty — write something first.");
    return;
  }
  const cards = host.deckService.getCards();
  if (cards.length === 0) {
    new Notice("Your deck is empty — add words at inoh.app, then refresh from the settings.");
    return;
  }
  const editorView = getEditorView(editor);
  if (!editorView) {
    new Notice("Could not access the editor.");
    return;
  }
  const selectionFrom = hasSelection ? editor.posToOffset(editor.getCursor("from")) : 0;
  const selectionTo = hasSelection
    ? editor.posToOffset(editor.getCursor("to"))
    : editorView.state.doc.length;

  const wasTruncated = suggestionText.length > MAX_SUGGESTION_TEXT_LENGTH;

  isSuggestionRequestInFlight = true;
  const loadingNotice = new Notice("Inoh: looking for places to use your deck words…", 0);
  try {
    const result = await requestDeckWordSuggestions(
      host.supabase,
      suggestionText.slice(0, MAX_SUGGESTION_TEXT_LENGTH),
      cards,
    );
    // The server only returns the word; its definition lives on the deck card.
    const suggestionsWithDefinitions = result.suggestions.map((suggestion) => ({
      ...suggestion,
      definition: cards.find(
        (card) => card.dictionary.word.toLowerCase() === suggestion.word.toLowerCase(),
      )?.dictionary.definition,
    }));
    const resolved = resolveSuggestionRanges(
      editorView.state.doc.toString(),
      selectionFrom,
      selectionTo,
      suggestionsWithDefinitions,
    );
    const truncationSuffix = describeTruncation(wasTruncated);
    if (resolved.length === 0) {
      const scope = hasSelection ? "selection" : "note";
      new Notice(`No good fits in this ${scope} — keep writing!${truncationSuffix}`);
      return;
    }
    editorView.dispatch({ effects: setSuggestionsEffect.of(resolved) });
    const suggestionCount = `${resolved.length} suggestion${resolved.length === 1 ? "" : "s"}`;
    const quotaSuffix =
      result.remainingSuggestionsToday !== undefined
        ? ` ${result.remainingSuggestionsToday} free suggestions left today.`
        : "";
    new Notice(
      `${suggestionCount} marked — hover a phrase to apply.${quotaSuffix}${truncationSuffix}`,
    );
  } catch (error) {
    if (error instanceof SuggestionLimitError) {
      // The server owns the daily limit, so its message is the only place the
      // real number appears — show it rather than restating it here.
      host.account.promptUpgrade(error.message);
      return;
    }
    new Notice(error instanceof Error ? error.message : String(error));
  } finally {
    isSuggestionRequestInFlight = false;
    loadingNotice.hide();
  }
}

/**
 * Says that only the head of the text was checked. Without this the dropped
 * tail reads as the model having missed things.
 *
 * @param wasTruncated - Whether the text exceeded the server's limit
 * @returns A sentence to append to the result notice, or an empty string
 */
function describeTruncation(wasTruncated: boolean): string {
  if (!wasTruncated) {
    return "";
  }
  const checkedLength = MAX_SUGGESTION_TEXT_LENGTH.toLocaleString();
  // Opening the command palette drops the selection on mobile, so only suggest
  // selecting a section where that actually works.
  const advice = Platform.isMobile ? "" : " — select a section to check the rest";
  return ` Only the first ${checkedLength} characters were checked${advice}.`;
}
