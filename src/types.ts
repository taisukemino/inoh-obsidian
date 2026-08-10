/** Card learning state — maps to FSRS State. Stored as a postgres enum. */
export type CardState = "new" | "learning" | "review" | "relearning";

/**
 * The dictionary columns the plugin actually fetches. The full table also
 * carries media paths and quiz distractors, which the highlighter never uses.
 */
export type DictionarySummary = {
  id: string;
  word: string;
  definition: string;
  example_sentence: string;
  phonetic: string | null;
  /** CEFR difficulty: 1=A1 … 6=C2. */
  difficulty_level: number | null;
  /** Path inside the public audio bucket; may be missing in pre-audio caches. */
  word_audio_path?: string | null;
};

/** A card in the user's deck, joined with its dictionary entry. */
export type DeckCard = {
  id: string;
  deck_id: string;
  dictionary_id: string;
  card_state: CardState;
  review_count: number;
  forget_count: number;
  next_review: string | null;
  dictionary: DictionarySummary;
};

export type Deck = {
  id: string;
  name: string;
  /** Missing in deck caches persisted before the add-word feature. */
  is_default?: boolean;
};

/** One dictionary hit for selected text — enough to pick a sense and add it. */
export type DictionaryLookupEntry = {
  id: string;
  word: string;
  definition: string;
};

/** A deck word located in editor text, in absolute document offsets. */
export type DeckMatch = {
  from: number;
  to: number;
  card: DeckCard;
};

export type InohSettings = {
  highlightEnabled: boolean;
};

export type DeckCache = {
  fetchedAt: number;
  cards: DeckCard[];
  decks: Deck[];
};

/** Shape of data.json. Never put auth tokens here — the vault syncs. */
export type PluginData = {
  settings: InohSettings;
  deckCache: DeckCache | null;
};
