import { Notice, type App, type Editor } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateLemmaCandidates } from "../matching";
import type { AccountService } from "../subscriptions";
import type { DeckCard, DictionaryLookupEntry } from "../types";
import { CardLimitError, type DeckService } from "./deck-service";
import { findDictionaryEntries } from "./dictionary-lookup";
import { SensePickerModal } from "./sense-picker-modal";

/** Same gates as the Chrome extension's selection button. */
const MAX_WORD_LENGTH = 50;
const MAX_WORD_TOKENS = 4;

/** What the add-word flow needs from the plugin. */
export type AddWordHost = {
  app: App;
  supabase: SupabaseClient;
  currentUserEmail: string | null;
  deckService: Pick<DeckService, "addCard" | "getCards">;
  account: Pick<AccountService, "promptUpgrade">;
};

/** A single word or short phrase — something the dictionary could contain. */
export function isAddableWord(text: string): boolean {
  return (
    text.length > 0 &&
    text.length <= MAX_WORD_LENGTH &&
    text.split(/\s+/).length <= MAX_WORD_TOKENS &&
    /[A-Za-z]/.test(text)
  );
}

/**
 * Checks whether the deck already covers the selected text, including
 * inflected selections ("flipped" when "flip" is a deck word). Used to hide
 * the selection add-button for words the user is already learning.
 *
 * @param cards - The cached deck cards
 * @param selectedText - Raw selection from the editor
 */
export function isWordInDeck(cards: DeckCard[], selectedText: string): boolean {
  const candidates = new Set(generateLemmaCandidates(selectedText));
  return cards.some((card) => candidates.has(card.dictionary.word.toLowerCase()));
}

/**
 * Returns the selected text when it looks like an addable word, else null.
 * Used to decide whether the editor context menu shows the add item.
 *
 * @param editor - The active markdown editor
 */
export function getAddableSelection(editor: Editor): string | null {
  const selectedText = editor.getSelection().trim();
  return isAddableWord(selectedText) ? selectedText : null;
}

/**
 * Command entry point: adds the selected word (or the word under the cursor
 * when nothing is selected — opening the command palette drops the selection
 * on mobile) to the user's Inoh deck.
 *
 * @param host - The plugin, providing the session and deck service
 * @param editor - The active markdown editor
 */
export async function addWordFromEditor(host: AddWordHost, editor: Editor): Promise<void> {
  const selectedText = editor.getSelection().trim() || _getWordAtCursor(editor);
  if (!selectedText) {
    new Notice("Select a word to add to your deck.");
    return;
  }
  await addWordToDeck(host, selectedText);
}

/**
 * Looks the text up in the dictionary and adds it to the deck — asking which
 * sense when there are several. Shared by the command, the context menu, and
 * the selection add-button.
 *
 * @param host - The plugin, providing the session and deck service
 * @param selectedText - The word or short phrase to add
 */
export async function addWordToDeck(host: AddWordHost, selectedText: string): Promise<void> {
  if (!isAddableWord(selectedText)) {
    new Notice("Select a single word or a short phrase.");
    return;
  }
  if (!host.currentUserEmail) {
    new Notice("Sign in to Inoh first (plugin settings).");
    return;
  }

  let entries: DictionaryLookupEntry[];
  try {
    entries = await findDictionaryEntries(host.supabase, selectedText);
  } catch (error) {
    new Notice(error instanceof Error ? error.message : String(error));
    return;
  }

  if (entries.length === 0) {
    new Notice(`"${selectedText}" isn't in the Inoh dictionary yet.`);
    return;
  }
  if (entries.length === 1) {
    await _addEntryToDeck(host, entries[0]);
    return;
  }
  new SensePickerModal(host.app, selectedText, entries, (pickedEntry) => {
    void _addEntryToDeck(host, pickedEntry);
  }).open();
}

/** The word under the cursor, or an empty string when the cursor is not on one. */
function _getWordAtCursor(editor: Editor): string {
  const wordRange = editor.wordAt(editor.getCursor());
  return wordRange ? editor.getRange(wordRange.from, wordRange.to) : "";
}

/**
 * Adds one dictionary entry, reporting the outcome as a Notice — except a
 * full deck, which opens the upgrade modal instead.
 */
async function _addEntryToDeck(host: AddWordHost, entry: DictionaryLookupEntry): Promise<void> {
  const isAlreadyInDeck = host.deckService
    .getCards()
    .some((card) => card.dictionary_id === entry.id);
  if (isAlreadyInDeck) {
    new Notice(`"${entry.word}" is already in your deck.`);
    return;
  }

  const addingNotice = new Notice(`Adding "${entry.word}" to your deck…`, 0);
  try {
    await host.deckService.addCard(entry.id);
    new Notice(`Added "${entry.word}" to your deck.`);
  } catch (error) {
    if (error instanceof CardLimitError) {
      // The server owns the plan limits, so its message is the only place the
      // real numbers appear — show it rather than restating them here.
      host.account.promptUpgrade(error.message);
      return;
    }
    new Notice(error instanceof Error ? error.message : String(error));
  } finally {
    addingNotice.hide();
  }
}
