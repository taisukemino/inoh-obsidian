import { FunctionsHttpError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeckCard } from "../types";

export type DeckWordSuggestion = {
  /** Exact substring of the paragraph to replace. */
  original: string;
  /** The original phrase rewritten using the deck word. */
  replacement: string;
  /** The deck word used, as written in the deck. */
  word: string;
};

export type SuggestionResult = {
  suggestions: DeckWordSuggestion[];
  /** Only present for free-plan users. */
  remainingSuggestionsToday?: number;
};

/** Thrown when the free daily cap is reached (edge function code SUGGESTION_LIMIT). */
export class SuggestionLimitError extends Error {}

/**
 * Asks the suggest-deck-words edge function where the paragraph could use a
 * deck word. The OpenAI key lives server-side; the user's Supabase session
 * authenticates the call and Pro/free limits are enforced there.
 *
 * @param supabase - Signed-in Supabase client
 * @param paragraph - The paragraph the user is writing
 * @param deckCards - Deck cards to suggest from (already filtered by settings)
 * @returns Validated suggestions plus the remaining free quota, if capped
 * @throws {SuggestionLimitError} When the free daily limit is used up
 * @throws {Error} When the request fails for any other reason
 */
export async function requestDeckWordSuggestions(
  supabase: SupabaseClient,
  paragraph: string,
  deckCards: DeckCard[],
): Promise<SuggestionResult> {
  const deckWords = deckCards.map((card) => ({
    word: card.dictionary.word,
    definition: card.dictionary.definition,
  }));

  const { data, error } = await supabase.functions.invoke("suggest-deck-words", {
    body: {
      paragraph,
      deckWords,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });

  if (error) {
    throw await toFriendlyError(error);
  }
  return data as SuggestionResult;
}

async function toFriendlyError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string; code?: string };
      if (body.code === "SUGGESTION_LIMIT") {
        return new SuggestionLimitError(body.error ?? "Daily suggestion limit reached.");
      }
      if (body.error) {
        return new Error(body.error);
      }
    } catch {
      // Fall through to the generic message.
    }
  }
  return new Error("Could not get suggestions. Check your connection and try again.");
}
