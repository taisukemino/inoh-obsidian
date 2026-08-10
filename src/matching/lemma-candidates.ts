import { getIrregularVariants } from "./irregular-verb-forms";
import { normalizeWord } from "./token-compat";

/**
 * Generates dictionary-lookup candidates for selected text, so selecting an
 * inflected form still finds its entry ("flipped" → "flip", "went" → "go",
 * "knives" → "knife"). This is the reverse of `inflections.ts`, which expands
 * a deck word into its surface forms. Ported from the Inoh browser extension.
 *
 * Over-generation is fine: bogus candidates ("flipp") simply match no
 * dictionary row, and when several candidates are real words ("seed" → seed,
 * see) the caller shows every hit with its definition for the user to pick.
 */

const MAX_CANDIDATES = 12;

/** Characters safe to embed in a PostgREST or() filter value. */
const SAFE_CANDIDATE_PATTERN = /^[a-z][a-z' -]*$/;

function _endsWithDoubledConsonant(base: string): boolean {
  return base.length >= 2 && base[base.length - 1] === base[base.length - 2];
}

/** Reverses regular -s/-ed/-ing/plural rules for one lowercased token. */
function _generateTokenCandidates(token: string): Set<string> {
  const candidates = new Set<string>([token]);

  if (token.endsWith("ies") && token.length > 4) {
    candidates.add(`${token.slice(0, -3)}y`); // carries → carry
  }
  if (token.endsWith("ves") && token.length > 4) {
    candidates.add(`${token.slice(0, -3)}f`); // leaves → leaf
    candidates.add(`${token.slice(0, -3)}fe`); // knives → knife
  }
  if (token.endsWith("es") && token.length > 3) {
    candidates.add(token.slice(0, -2)); // crosses → cross
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 2) {
    candidates.add(token.slice(0, -1)); // meetings → meeting
  }
  if (token.endsWith("ied") && token.length > 4) {
    candidates.add(`${token.slice(0, -3)}y`); // carried → carry
  }
  if (token.endsWith("ed") && token.length > 3) {
    const withoutEd = token.slice(0, -2);
    candidates.add(withoutEd); // crossed → cross
    candidates.add(token.slice(0, -1)); // loved → love
    if (_endsWithDoubledConsonant(withoutEd)) {
      candidates.add(withoutEd.slice(0, -1)); // flipped → flip
    }
  }
  if (token.endsWith("ing") && token.length > 4) {
    const withoutIng = token.slice(0, -3);
    candidates.add(withoutIng); // crossing → cross
    candidates.add(`${withoutIng}e`); // making → make
    if (_endsWithDoubledConsonant(withoutIng)) {
      candidates.add(withoutIng.slice(0, -1)); // planning → plan
    }
  }

  for (const variant of getIrregularVariants(token)) {
    candidates.add(variant); // went → go, gone, goes, going
  }

  return candidates;
}

/**
 * Returns lookup candidates for the selected text, the selection itself
 * first. Multi-word selections vary only their first token ("gave up" →
 * "give up"), matching how deck phrases inflect.
 *
 * @param selectedText - Raw selection from the editor
 * @returns Lowercased candidate words/phrases, safe for a PostgREST filter
 */
export function generateLemmaCandidates(selectedText: string): string[] {
  const normalized = normalizeWord(selectedText).replace(/\s+/g, " ");
  const [firstToken, ...restTokens] = normalized.split(" ");
  if (!firstToken) {
    return [];
  }

  const restOfPhrase = restTokens.length > 0 ? ` ${restTokens.join(" ")}` : "";
  const candidates = new Set<string>([normalized]);
  for (const tokenCandidate of _generateTokenCandidates(firstToken)) {
    candidates.add(`${tokenCandidate}${restOfPhrase}`);
  }

  return Array.from(candidates)
    .filter((candidate) => SAFE_CANDIDATE_PATTERN.test(candidate))
    .slice(0, MAX_CANDIDATES);
}
