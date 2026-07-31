import levenshtein from "fast-levenshtein";
import { isIrregularVerbMatch } from "./irregular-verb-forms";

/**
 * Token-level matching primitives, ported from the Inoh app's
 * `src/lib/sentence-utils.ts` (compatibility scoring) and
 * `src/lib/word-validation.ts` (normalization). The app's `getSentenceParts`
 * itself is not ported — it always "finds" the word, which is the wrong shape
 * for highlighting; the plugin's matcher inverts the loop around these
 * primitives instead.
 */

export type TokenCompatibility = {
  compatible: boolean;
  /** Strong = exact / prefix / consonant-skeleton / irregular-verb. Weak = typo-level edit. */
  strong: boolean;
};

export type TokenMatch = {
  value: string;
  start: number;
  end: number;
};

/** Canonical apostrophe (U+0027). iOS keyboards often produce U+2019. */
const APOSTROPHE_VARIANTS = /['‘’ʼʹ]/g;
const CANONICAL_APOSTROPHE = "'";

const VERY_SHORT_TOKEN_LENGTH = 3;
const MAX_VERY_SHORT_TOKEN_DISTANCE = 1;
const MAX_OTHER_TOKEN_DISTANCE = 1;
export const MIN_SKELETON_TOKEN_LENGTH = 4;

export function normalizeApostrophes(text: string): string {
  return text.replace(APOSTROPHE_VARIANTS, CANONICAL_APOSTROPHE);
}

/** Trims, lowercases, and canonicalizes apostrophes for comparison. */
export function normalizeWord(word: string): string {
  return normalizeApostrophes(word.trim().toLowerCase());
}

function getTokenDistanceLimit(tokenLength: number): number {
  return tokenLength <= VERY_SHORT_TOKEN_LENGTH
    ? MAX_VERY_SHORT_TOKEN_DISTANCE
    : MAX_OTHER_TOKEN_DISTANCE;
}

export function getConsonantSkeleton(token: string): string {
  return token.toLowerCase().replace(/[aeiou]/g, "");
}

/** Splits text into word tokens, keeping their character offsets. */
export function tokenizeWithIndices(text: string): TokenMatch[] {
  const matches = text.matchAll(/[A-Za-z]+(?:'[A-Za-z]+)*/g);
  return Array.from(matches, (match) => ({
    value: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/**
 * Scores how compatible a typed token is with a deck-word token.
 *
 * Strong signals: exact match or irregular verb relation. Regular inflections
 * are handled by exact membership in the generated form sets (see
 * `inflections.ts`) — the app's prefix/stem tier was removed because it
 * over-matched in prose ("brain" lit up "brainy"). Weak signals (tolerant
 * mode only): consonant-skeleton equality for tokens of 4+ chars, or a
 * typo-level Levenshtein edit gated on the same starting letter.
 */
export function getTokenCompatibility(typedToken: string, targetToken: string): TokenCompatibility {
  const left = normalizeApostrophes(typedToken.toLowerCase());
  const right = normalizeApostrophes(targetToken.toLowerCase());

  if (left === right) {
    return { compatible: true, strong: true };
  }

  if (isIrregularVerbMatch(left, right)) {
    return { compatible: true, strong: true };
  }

  // Weak only: skeleton equality also matches unrelated words ("vice"/"voice").
  // The app treats it as strong, but there it locates a word already known to
  // be in the sentence; for highlighting it must not stand on its own.
  const leftSkeleton = getConsonantSkeleton(left);
  const rightSkeleton = getConsonantSkeleton(right);
  if (
    left.length >= MIN_SKELETON_TOKEN_LENGTH &&
    right.length >= MIN_SKELETON_TOKEN_LENGTH &&
    leftSkeleton === rightSkeleton
  ) {
    return { compatible: true, strong: false };
  }

  // Weak compatibility only: small typo-level edits, gated by same starting letter.
  if (left[0] !== right[0]) {
    return { compatible: false, strong: false };
  }

  const maxDistance = Math.max(getTokenDistanceLimit(left.length), getTokenDistanceLimit(right.length));
  const isLevenshteinMatch = levenshtein.get(left, right) <= maxDistance;
  return { compatible: isLevenshteinMatch, strong: false };
}
