import { describe, expect, it } from "vitest";
import type { DeckCard } from "../types";
import { DeckIndex } from "./deck-index";
import { DeckMatcher } from "./matcher";

function makeCard(word: string): DeckCard {
  return {
    id: `card-${word}`,
    deck_id: "deck-1",
    dictionary_id: `dict-${word}`,
    card_state: "new",
    review_count: 0,
    forget_count: 0,
    next_review: null,
    dictionary: {
      id: `dict-${word}`,
      word,
      definition: `definition of ${word}`,
      example_sentence: `example with ${word}`,
      phonetic: null,
      difficulty_level: 3,
    },
  };
}

function matchWords(deckWords: string[], text: string, tolerant = false): string[] {
  const index = new DeckIndex(deckWords.map(makeCard));
  const matcher = new DeckMatcher(index, { tolerant });
  return matcher.scanText(text, 0).map((match) => text.slice(match.from, match.to));
}

describe("single words", () => {
  it("matches an exact deck word, case-insensitively", () => {
    expect(matchWords(["superb"], "It was a superb outcome.")).toEqual(["superb"]);
    expect(matchWords(["superb"], "Superb work!")).toEqual(["Superb"]);
  });

  it("matches regular inflections", () => {
    expect(matchWords(["cross"], "We crossed a few wires.")).toEqual(["crossed"]);
    expect(matchWords(["cross"], "Crossing the street.")).toEqual(["Crossing"]);
    expect(matchWords(["meeting"], "Two meetings today.")).toEqual(["meetings"]);
    expect(matchWords(["carry"], "She carried it. He carries on.")).toEqual([
      "carried",
      "carries",
    ]);
    expect(matchWords(["plan"], "We planned it while planning more.")).toEqual([
      "planned",
      "planning",
    ]);
    expect(matchWords(["love"], "They loved it.")).toEqual(["loved"]);
    expect(matchWords(["make"], "Making progress.")).toEqual(["Making"]);
  });

  it("matches irregular verb forms", () => {
    expect(matchWords(["go"], "The meeting went well.")).toEqual(["went"]);
    expect(matchWords(["swim"], "She swam far.")).toEqual(["swam"]);
  });

  it("matches irregular noun plurals", () => {
    expect(matchWords(["criterion"], "Three criteria apply.")).toEqual(["criteria"]);
    expect(matchWords(["knife"], "Sharpen the knives.")).toEqual(["knives"]);
  });

  it("does not match a word that merely starts with the typed token (brain vs brainy)", () => {
    expect(matchWords(["brainy"], "Brain Dump")).toEqual([]);
  });

  it("does not match a longer word that starts with the deck word (crossword vs cross)", () => {
    expect(matchWords(["cross"], "A crossword puzzle.")).toEqual([]);
  });

  it("does not match different words that share a consonant skeleton", () => {
    // "vice" and "voice" both skeletonize to "vc" — must not highlight by default.
    expect(matchWords(["vice"], "Voice chat is open.")).toEqual([]);
  });

  it("does not match half-typed short tokens", () => {
    expect(matchWords(["cross"], "cr")).toEqual([]);
  });

  it("does not match unrelated words", () => {
    expect(matchWords(["superb"], "It was a great outcome.")).toEqual([]);
  });

  it("reports absolute offsets relative to baseOffset", () => {
    const index = new DeckIndex([makeCard("superb")]);
    const matcher = new DeckMatcher(index, { tolerant: false });
    const text = "a superb day";
    const [match] = matcher.scanText(text, 100);
    expect(match.from).toBe(102);
    expect(match.to).toBe(108);
  });
});

describe("tolerant mode", () => {
  it("rejects typo-level matches unless tolerant matching is on", () => {
    expect(matchWords(["superb"], "It was zuperb.")).toEqual([]);
    // "suberb" shares the first letter, one edit away → weak tier.
    expect(matchWords(["superb"], "It was suberb.", true)).toEqual(["suberb"]);
  });

  it("matches vowel-differing misspellings via skeleton only in tolerant mode", () => {
    expect(matchWords(["gorgeous"], "What a gorgous view.")).toEqual([]);
    expect(matchWords(["gorgeous"], "What a gorgous view.", true)).toEqual(["gorgous"]);
  });
});

describe("phrases and idioms", () => {
  it("matches a contiguous phrase with inflected tokens", () => {
    expect(matchWords(["give up"], "I almost gave up twice.")).toEqual(["gave up"]);
    expect(matchWords(["hit the jackpot"], "They hit the jackpot!")).toEqual([
      "hit the jackpot",
    ]);
  });

  it("matches phrases with inflection on any token", () => {
    expect(matchWords(["cough drop"], "Buy some cough drops.")).toEqual(["cough drops"]);
  });

  it("matches separable phrasal verbs across small gaps", () => {
    expect(matchWords(["give up"], "Don't give it up yet.")).toEqual(["give it up"]);
    expect(matchWords(["give up"], "She gave the idea up.")).toEqual(["gave the idea up"]);
  });

  it("does not bridge gaps larger than two tokens", () => {
    expect(matchWords(["give up"], "Give the whole silly plan up.")).toEqual([]);
  });

  it("does not treat non-particle phrases as separable", () => {
    expect(matchWords(["red meat"], "The red car hit meat trucks.")).toEqual([]);
  });

  it("matches possessive placeholders (one's → my/your/…)", () => {
    expect(matchWords(["count one's blessings"], "I counted my blessings.")).toEqual([
      "counted my blessings",
    ]);
    expect(matchWords(["take to one's heels"], "He took to his heels.")).toEqual([
      "took to his heels",
    ]);
  });

  it("matches possessive placeholders against name possessives", () => {
    expect(matchWords(["put someone's back up"], "That put Maria's back up.")).toEqual([
      "put Maria's back up",
    ]);
  });

  it("matches person placeholders (someone → him/her/…)", () => {
    expect(matchWords(["have someone by the short hairs"], "They have him by the short hairs."))
      .toEqual(["have him by the short hairs"]);
  });

  it("requires every phrase token to match", () => {
    expect(matchWords(["hit the jackpot"], "They hit the wall.")).toEqual([]);
  });

  it("keeps the leftmost-longest match when spans overlap", () => {
    expect(matchWords(["give up", "give"], "Never give up hope.")).toEqual(["give up"]);
  });

  it("matches hyphenated deck words against hyphenated or spaced text", () => {
    expect(matchWords(["state-of-the-art"], "A state-of-the-art lab.")).toEqual([
      "state-of-the-art",
    ]);
    expect(matchWords(["state-of-the-art"], "A state of the art lab.")).toEqual([
      "state of the art",
    ]);
  });
});
