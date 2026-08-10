import type { DeckCard } from "../types";
import {
  generateWordForms,
  PERSON_PLACEHOLDERS,
  PERSON_PRONOUNS,
  PHRASAL_VERB_PARTICLES,
  POSSESSIVE_PLACEHOLDERS,
  POSSESSIVE_PRONOUNS,
} from "./inflections";
import { getConsonantSkeleton, normalizeWord, MIN_SKELETON_TOKEN_LENGTH } from "./token-compat";

/** How one deck-word token accepts typed tokens. */
export type TokenMatcher = {
  /** Exact surface forms this token accepts (base + inflections, lowercased). */
  forms: Set<string>;
  /** For "one's"-style placeholders: also accept any token ending in "'s". */
  acceptsAnyPossessive: boolean;
};

/** A deck word prepared for matching. */
export type IndexEntry = {
  card: DeckCard;
  /** Normalized tokens of the deck word ("give up" → ["give", "up"]). */
  targetTokens: string[];
  /** One matcher per target token. */
  tokenMatchers: TokenMatcher[];
  /** Separable phrasal verb: allow a small gap ("gave it up" for "give up"). */
  allowsGaps: boolean;
};

/**
 * Lookup structures over the deck, keyed by the FIRST token of each deck word.
 * Built once per deck refresh (~ms for 300 words) so that scanning editor text
 * is one map lookup per typed token instead of one regex pass per deck word.
 *
 * Matching is exact against generated inflection sets — a typed token must BE
 * one of the deck token's surface forms. The loose prefix/stem tiers were
 * removed after dogfooding ("brain" lit up "brainy", "crossword" lit up
 * "cross").
 */
export class DeckIndex {
  /** Every acceptable surface form of each entry's first token. */
  private readonly exactMap = new Map<string, IndexEntry[]>();
  /** Consonant skeleton of the first token — weak tier, tolerant mode only. */
  private readonly skeletonMap = new Map<string, IndexEntry[]>();
  /** First letter of the first token — bucket for the weak Levenshtein tier. */
  private readonly byFirstLetter = new Map<string, IndexEntry[]>();

  readonly entryCount: number;

  constructor(cards: DeckCard[]) {
    let entryCount = 0;
    for (const card of cards) {
      // Split on hyphens too: the editor tokenizer does, so "state-of-the-art"
      // must become four target tokens to ever match.
      const targetTokens = normalizeWord(card.dictionary.word)
        .split(/[\s-]+/)
        .filter((token) => token.length > 0);
      if (targetTokens.length === 0) {
        continue;
      }
      entryCount += 1;

      const entry: IndexEntry = {
        card,
        targetTokens,
        tokenMatchers: targetTokens.map(buildTokenMatcher),
        allowsGaps: targetTokens.length === 2 && PHRASAL_VERB_PARTICLES.has(targetTokens[1]),
      };

      const firstToken = targetTokens[0];
      this.addKeys(this.exactMap, entry.tokenMatchers[0].forms, entry);
      if (firstToken.length >= MIN_SKELETON_TOKEN_LENGTH) {
        this.addKeys(this.skeletonMap, [getConsonantSkeleton(firstToken)], entry);
      }
      this.addKeys(this.byFirstLetter, [firstToken[0]], entry);
    }
    this.entryCount = entryCount;
  }

  /**
   * Returns deck entries that might start at a typed token.
   *
   * @param typedToken - Lowercased, apostrophe-normalized token from the editor
   * @param tolerant - Whether to include the weak skeleton/Levenshtein buckets
   */
  candidatesFor(typedToken: string, tolerant: boolean): Set<IndexEntry> {
    const candidates = new Set<IndexEntry>();
    this.collectInto(candidates, this.exactMap.get(typedToken));

    if (tolerant) {
      if (typedToken.length >= MIN_SKELETON_TOKEN_LENGTH) {
        this.collectInto(candidates, this.skeletonMap.get(getConsonantSkeleton(typedToken)));
      }
      this.collectInto(candidates, this.byFirstLetter.get(typedToken[0]));
    }

    return candidates;
  }

  private addKeys(map: Map<string, IndexEntry[]>, keys: Iterable<string>, entry: IndexEntry): void {
    for (const key of keys) {
      const existing = map.get(key);
      if (existing) {
        existing.push(entry);
      } else {
        map.set(key, [entry]);
      }
    }
  }

  private collectInto(target: Set<IndexEntry>, entries: IndexEntry[] | undefined): void {
    for (const entry of entries ?? []) {
      target.add(entry);
    }
  }
}

function buildTokenMatcher(targetToken: string): TokenMatcher {
  if (POSSESSIVE_PLACEHOLDERS.has(targetToken)) {
    return { forms: POSSESSIVE_PRONOUNS, acceptsAnyPossessive: true };
  }
  if (PERSON_PLACEHOLDERS.has(targetToken)) {
    return { forms: PERSON_PRONOUNS, acceptsAnyPossessive: false };
  }
  return { forms: generateWordForms(targetToken), acceptsAnyPossessive: false };
}
