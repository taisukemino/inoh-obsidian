import { MIN_FUZZY_TOKEN_LENGTH } from "../constants";
import type { DeckCard, DeckMatch } from "../types";
import { DeckIndex, type IndexEntry, type TokenMatcher } from "./deck-index";
import {
  getTokenCompatibility,
  normalizeApostrophes,
  tokenizeWithIndices,
  type TokenMatch,
} from "./token-compat";

export type MatcherOptions = {
  /** Accept weak (skeleton / typo-level Levenshtein) matches. */
  tolerant: boolean;
};

/** How many filler tokens a separable phrasal verb may span ("gave it all up"). */
const MAX_PHRASE_GAP_TOKENS = 2;

type TokenMatchStrength = "strong" | "weak" | "none";

/**
 * Finds deck words in editor text.
 *
 * Token-driven: tokenizes the text once, then looks each token up against the
 * prebuilt {@link DeckIndex}. A typed token matches a deck token only if it is
 * exactly one of its generated surface forms (or, in tolerant mode, a weak
 * skeleton/typo match). Phrases match per-token, with placeholder support
 * ("one's" ← any possessive) and small gaps for separable phrasal verbs.
 */
export class DeckMatcher {
  constructor(
    private readonly index: DeckIndex,
    private readonly options: MatcherOptions,
  ) {}

  /**
   * Scans a slice of document text for deck words.
   *
   * @param text - The text slice (e.g., one visible range of the editor)
   * @param baseOffset - Absolute document offset of the slice's first character
   * @returns Non-overlapping matches in document order
   */
  scanText(text: string, baseOffset: number): DeckMatch[] {
    const tokens = tokenizeWithIndices(text);
    const matches: DeckMatch[] = [];

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const typedToken = normalizeApostrophes(tokens[tokenIndex].value.toLowerCase());
      const candidates = this.index.candidatesFor(typedToken, this.options.tolerant);

      let best: { end: number; card: DeckCard } | null = null;
      for (const candidate of candidates) {
        const span = this.matchAt(tokens, tokenIndex, candidate);
        if (span && (!best || span.end > best.end)) {
          best = { end: span.end, card: candidate.card };
        }
      }

      if (best) {
        matches.push({
          from: baseOffset + tokens[tokenIndex].start,
          to: baseOffset + best.end,
          card: best.card,
        });
      }
    }

    return dropOverlaps(matches);
  }

  /** Verifies a candidate deck word starting at the given token. */
  private matchAt(
    tokens: TokenMatch[],
    startIndex: number,
    candidate: IndexEntry,
  ): { end: number } | null {
    let hasStrongSignal = false;
    let tokenIndex = startIndex;
    let gapsRemaining = candidate.allowsGaps ? MAX_PHRASE_GAP_TOKENS : 0;
    let end = -1;

    for (let targetIndex = 0; targetIndex < candidate.tokenMatchers.length; targetIndex += 1) {
      let matched = false;

      while (tokenIndex < tokens.length) {
        const typed = normalizeApostrophes(tokens[tokenIndex].value.toLowerCase());
        const strength = this.matchToken(
          typed,
          candidate.tokenMatchers[targetIndex],
          candidate.targetTokens[targetIndex],
        );

        if (strength !== "none") {
          hasStrongSignal = hasStrongSignal || strength === "strong";
          end = tokens[tokenIndex].end;
          tokenIndex += 1;
          matched = true;
          break;
        }

        // Unmatched token: only a separable phrasal verb may skip over it,
        // and never before its first token.
        if (targetIndex === 0 || gapsRemaining === 0) {
          return null;
        }
        gapsRemaining -= 1;
        tokenIndex += 1;
      }

      if (!matched) {
        return null;
      }
    }

    // Weak-only matches are allowed solely for single words in tolerant mode.
    if (!hasStrongSignal && !(candidate.targetTokens.length === 1 && this.options.tolerant)) {
      return null;
    }

    return { end };
  }

  private matchToken(
    typed: string,
    matcher: TokenMatcher,
    targetToken: string,
  ): TokenMatchStrength {
    if (matcher.forms.has(typed)) {
      return "strong";
    }
    if (matcher.acceptsAnyPossessive && typed.endsWith("'s")) {
      return "strong";
    }
    if (this.options.tolerant && typed.length >= MIN_FUZZY_TOKEN_LENGTH) {
      const compatibility = getTokenCompatibility(typed, targetToken);
      if (compatibility.compatible) {
        return "weak";
      }
    }
    return "none";
  }
}

/** Keeps the leftmost-longest match when spans overlap. */
function dropOverlaps(matches: DeckMatch[]): DeckMatch[] {
  const kept: DeckMatch[] = [];
  let lastEnd = -1;

  for (const match of matches) {
    if (match.from >= lastEnd) {
      kept.push(match);
      lastEnd = match.to;
    }
  }

  return kept;
}
