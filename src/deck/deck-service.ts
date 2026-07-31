import { Events } from "obsidian";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Deck, DeckCache, DeckCard } from "../types";

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
    difficulty_level
  )
`;

/**
 * Holds the user's deck in memory and keeps a copy in plugin data so
 * highlighting works instantly on startup and offline.
 *
 * The free tier caps decks at 300 cards and `user_cards` has no updated_at
 * cursor, so "sync" is always a full refetch. Emits `"deck-changed"` after
 * every successful refresh or cache load.
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
        this.supabase.from("user_cards").select(DECK_CARD_SELECT).eq("user_id", session.user.id),
        this.supabase
          .from("decks")
          .select("id, name")
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
      this.decks = decksResult.data as Deck[];
      this.fetchedAt = Date.now();
      await this.persistCache({ fetchedAt: this.fetchedAt, cards: this.cards, decks: this.decks });
    } finally {
      this.isRefreshing = false;
      this.trigger("deck-changed");
    }
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
