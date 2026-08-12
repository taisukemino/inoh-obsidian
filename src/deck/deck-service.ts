import { Events } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Deck, DeckCache, DeckCard } from "../types";

const POSTGRESQL_UNIQUE_VIOLATION = "23505";

/** user_cards has UNIQUE (user_id, dictionary_id) — a violation means "already added". */
function isDuplicateCardError(error: { code?: string; message?: string }): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === POSTGRESQL_UNIQUE_VIOLATION ||
    message.includes("duplicate") ||
    message.includes("unique")
  );
}

/** Thrown when the plan's total-card limit is reached (trigger message code CARD_LIMIT). */
export class CardLimitError extends Error {}

const CARD_LIMIT_CODE = "CARD_LIMIT";

/**
 * A user_cards BEFORE INSERT trigger enforces the plan's total-card limit
 * (Free 300, Plus 1,000, Pro unlimited), rejecting the insert with
 * `CARD_LIMIT: <user-facing message>`. Everything through the code is
 * stripped so only the server's explanation reaches the upgrade modal.
 */
function toCardLimitError(rawMessage: string): CardLimitError {
  const afterCode = rawMessage.slice(rawMessage.indexOf(CARD_LIMIT_CODE) + CARD_LIMIT_CODE.length);
  const reason = afterCode.replace(/^\s*:/, "").trim();
  return new CardLimitError(reason || "You've reached your plan's card limit.");
}

const DECK_CARD_SELECT = `
  id,
  deck_id,
  dictionary_id,
  card_state,
  review_count,
  forget_count,
  next_review,
  dictionary (
    id,
    word,
    definition,
    example_sentence,
    phonetic,
    difficulty_level,
    word_audio_path
  )
`;

/**
 * Holds the user's deck in memory and keeps a copy in plugin data so
 * highlighting works instantly on startup and offline.
 *
 * `user_cards` has no updated_at cursor, so "sync" is always a full refetch.
 * Emits `"deck-changed"` after every successful refresh or cache load.
 */
export class DeckService extends Events {
  private cards: DeckCard[] = [];
  private decks: Deck[] = [];
  private fetchedAt: number | null = null;
  isRefreshing = false;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly persistCache: (cache: DeckCache) => Promise<void>,
  ) {
    super();
  }

  /** Restores the last-fetched deck from data.json (called once on plugin load). */
  loadFromCache(cache: DeckCache | null): void {
    if (!cache) {
      return;
    }
    this.cards = cache.cards;
    this.decks = cache.decks;
    this.fetchedAt = cache.fetchedAt;
    this.trigger("deck-changed");
  }

  /**
   * Refetches the whole deck and deck list from Supabase.
   *
   * @throws {Error} When the user is signed out or a query fails
   */
  async refresh(): Promise<void> {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    if (!session) {
      throw new Error("Sign in to load your deck.");
    }

    this.isRefreshing = true;
    this.trigger("deck-changed");
    try {
      const [cardsResult, decksResult] = await Promise.all([
        // Newest first, so capped payloads (e.g. suggestions) keep the words
        // the user is currently learning.
        this.supabase
          .from("user_cards")
          .select(DECK_CARD_SELECT)
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false }),
        this.supabase
          .from("decks")
          .select("id, name, is_default")
          .eq("user_id", session.user.id)
          .order("created_at"),
      ]);

      if (cardsResult.error) {
        throw new Error(`Failed to load your deck: ${cardsResult.error.message}`);
      }
      if (decksResult.error) {
        throw new Error(`Failed to load your decks: ${decksResult.error.message}`);
      }

      // Supabase types the joined `dictionary` relation loosely; the select
      // above matches DeckCard exactly.
      this.cards = cardsResult.data as unknown as DeckCard[];
      this.decks = decksResult.data;
      this.fetchedAt = Date.now();
      await this.persistCache({ fetchedAt: this.fetchedAt, cards: this.cards, decks: this.decks });
    } finally {
      this.isRefreshing = false;
      this.trigger("deck-changed");
    }
  }

  /**
   * Adds a dictionary entry to the user's default deck, then refetches the
   * whole deck so the new card (with its joined dictionary row) reaches the
   * cache and highlights without hand-building the row client-side.
   *
   * @param dictionaryId - The dictionary row to add
   * @throws {CardLimitError} When the plan's total-card limit is reached
   * @throws {Error} When signed out, the word is already in the deck, or the insert fails
   */
  async addCard(dictionaryId: string): Promise<void> {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    if (!session) {
      throw new Error("Sign in to edit your deck.");
    }

    // A pre-add-word cache has no is_default flag; refetch instead of
    // guessing which deck is the default.
    if (this.decks.length === 0 || this.decks.every((deck) => deck.is_default === undefined)) {
      await this.refresh();
    }
    const defaultDeck = this.decks.find((deck) => deck.is_default) ?? this.decks[0];
    if (!defaultDeck) {
      throw new Error("No deck found for this account.");
    }

    // DB defaults fill the FSRS columns (card_state "new", stability and
    // difficulty 0) — the same 3-column insert the backend's
    // approve_card_request RPC uses.
    const { error } = await this.supabase.from("user_cards").insert({
      user_id: session.user.id,
      dictionary_id: dictionaryId,
      deck_id: defaultDeck.id,
    });
    if (error) {
      if (isDuplicateCardError(error)) {
        throw new Error("This word is already in your deck.");
      }
      if (error.message.includes(CARD_LIMIT_CODE)) {
        throw toCardLimitError(error.message);
      }
      throw new Error(`Failed to add the word: ${error.message}`);
    }

    await this.refresh();
  }

  /**
   * Deletes one card from Supabase and drops it from the cached deck,
   * discarding its learning progress. Emits `"deck-changed"` so highlights,
   * the status bar, and the settings tab update without a full refetch.
   *
   * @param cardId - The user_cards row id to delete
   * @throws {Error} When the user is signed out or the delete fails
   */
  async removeCard(cardId: string): Promise<void> {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    if (!session) {
      throw new Error("Sign in to edit your deck.");
    }

    // Reason: the user_id filter is defence in depth on top of RLS,
    // mirroring the Inoh app's remove hook.
    const { error } = await this.supabase
      .from("user_cards")
      .delete()
      .eq("id", cardId)
      .eq("user_id", session.user.id);
    if (error) {
      throw new Error(`Failed to remove the word: ${error.message}`);
    }

    this.cards = this.cards.filter((card) => card.id !== cardId);
    await this.persistCache({
      fetchedAt: this.fetchedAt ?? Date.now(),
      cards: this.cards,
      decks: this.decks,
    });
    this.trigger("deck-changed");
  }

  /** Clears the in-memory deck and cache (called on sign-out). */
  async clear(): Promise<void> {
    this.cards = [];
    this.decks = [];
    this.fetchedAt = null;
    await this.persistCache({ fetchedAt: 0, cards: [], decks: [] });
    this.trigger("deck-changed");
  }

  /**
   * Returns the cached cards, optionally limited to one deck.
   *
   * @param deckId - Deck to filter by, or null for all decks
   */
  getCards(deckId: string | null = null): DeckCard[] {
    if (!deckId) {
      return this.cards;
    }
    return this.cards.filter((card) => card.deck_id === deckId);
  }

  getDecks(): Deck[] {
    return this.decks;
  }

  getFetchedAt(): number | null {
    return this.fetchedAt;
  }
}
