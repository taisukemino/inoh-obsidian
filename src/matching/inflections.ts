import { getIrregularVariants } from "./irregular-verb-forms";

/**
 * Generates the exact set of English surface forms for a deck-word token.
 *
 * This replaces the app's loose prefix/stem matching, which over-matched in
 * prose (typed "brain" lit up deck word "brainy", "crossword" lit up
 * "cross"). A typed token now matches only if it IS one of these forms.
 */

/** Irregular noun plurals not covered by the regular rules or the verb map. */
const IRREGULAR_PLURALS: Record<string, string[]> = {
  analysis: ["analyses"],
  child: ["children"],
  crisis: ["crises"],
  criterion: ["criteria"],
  foot: ["feet"],
  goose: ["geese"],
  hypothesis: ["hypotheses"],
  man: ["men"],
  mouse: ["mice"],
  person: ["people", "persons"],
  phenomenon: ["phenomena"],
  thesis: ["theses"],
  tooth: ["teeth"],
  woman: ["women"],
};

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function isVowel(char: string): boolean {
  return VOWELS.has(char);
}

/** "plan", "stop" — final consonant doubles before -ed/-ing (planned, stopping). */
function endsWithConsonantVowelConsonant(word: string): boolean {
  if (word.length < 3) {
    return false;
  }
  const [antepenultimate, penultimate, last] = word.slice(-3);
  return (
    !isVowel(antepenultimate) && isVowel(penultimate) && !isVowel(last) && !"wxy".includes(last)
  );
}

function endsWithConsonantY(word: string): boolean {
  return word.length >= 2 && word.endsWith("y") && !isVowel(word[word.length - 2]);
}

function addSForms(base: string, forms: Set<string>): void {
  if (/(s|x|z|ch|sh)$/.test(base)) {
    forms.add(`${base}es`);
  } else if (endsWithConsonantY(base)) {
    forms.add(`${base.slice(0, -1)}ies`);
  } else if (base.endsWith("o")) {
    forms.add(`${base}es`); // potatoes
    forms.add(`${base}s`); // photos
  } else {
    forms.add(`${base}s`);
  }
}

function addEdForms(base: string, forms: Set<string>): void {
  if (base.endsWith("e")) {
    forms.add(`${base}d`); // loved
  } else if (endsWithConsonantY(base)) {
    forms.add(`${base.slice(0, -1)}ied`); // carried
  } else {
    forms.add(`${base}ed`);
    if (endsWithConsonantVowelConsonant(base)) {
      forms.add(`${base}${base[base.length - 1]}ed`); // planned
    }
  }
}

function addIngForms(base: string, forms: Set<string>): void {
  if (base.endsWith("e") && !/(ee|ye|oe)$/.test(base)) {
    forms.add(`${base.slice(0, -1)}ing`); // making
  } else {
    forms.add(`${base}ing`);
    if (endsWithConsonantVowelConsonant(base)) {
      forms.add(`${base}${base[base.length - 1]}ing`); // planning
    }
  }
}

function addVesPlural(base: string, forms: Set<string>): void {
  if (base.endsWith("fe")) {
    forms.add(`${base.slice(0, -2)}ves`); // knives
  } else if (base.endsWith("f")) {
    forms.add(`${base.slice(0, -1)}ves`); // leaves
  }
}

/**
 * Returns every surface form a typed token may take for the given deck-word
 * token: the token itself, regular noun/verb inflections (-s/-es/-ies, -ed,
 * -ing with e-drop and consonant doubling), irregular plurals, and irregular
 * verb forms. Comparatives (-er/-est) and derivations (-ly) are deliberately
 * excluded — they over-match ("cooker" is not a use of "cook").
 *
 * @param token - Lowercased, apostrophe-normalized deck-word token
 * @returns All acceptable typed forms, including the token itself
 */
export function generateWordForms(token: string): Set<string> {
  const forms = new Set<string>([token]);

  // Tokens with apostrophes ("doesn't", "o'clock") only match verbatim.
  if (token.includes("'") || token.length < 2) {
    return forms;
  }

  addSForms(token, forms);
  addEdForms(token, forms);
  addIngForms(token, forms);
  addVesPlural(token, forms);

  for (const plural of IRREGULAR_PLURALS[token] ?? []) {
    forms.add(plural);
  }
  for (const verbForm of getIrregularVariants(token)) {
    forms.add(verbForm);
  }

  return forms;
}

/**
 * Idiom placeholders: dictionary phrases use "one's" / "someone's" for any
 * possessive ("count one's blessings" ← "counted my blessings") and
 * "someone" / "somebody" for any person object ("put someone's back up").
 */
export const POSSESSIVE_PLACEHOLDERS = new Set(["one's", "someone's", "somebody's"]);
export const PERSON_PLACEHOLDERS = new Set(["someone", "somebody"]);

export const POSSESSIVE_PRONOUNS = new Set([
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "one's",
  "someone's",
  "somebody's",
  "anyone's",
  "anybody's",
  "everyone's",
  "everybody's",
]);

export const PERSON_PRONOUNS = new Set([
  "me",
  "you",
  "him",
  "her",
  "it",
  "us",
  "them",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "everyone",
  "everybody",
]);

/**
 * Particles of separable phrasal verbs: "give up" must also match
 * "gave it up" / "gave the whole thing up".
 */
export const PHRASAL_VERB_PARTICLES = new Set([
  "up",
  "out",
  "off",
  "on",
  "in",
  "down",
  "away",
  "back",
  "over",
  "around",
  "through",
]);
