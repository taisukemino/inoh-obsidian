import { describe, expect, it } from "vitest";
import { generateLemmaCandidates } from "./lemma-candidates";

describe("generateLemmaCandidates", () => {
  it("keeps the selection itself as the first candidate", () => {
    expect(generateLemmaCandidates("Robust")[0]).toBe("robust");
  });

  it("reverses consonant doubling (flipped → flip)", () => {
    expect(generateLemmaCandidates("flipped")).toContain("flip");
    expect(generateLemmaCandidates("planning")).toContain("plan");
  });

  it("reverses -ied and -ies (carried → carry)", () => {
    expect(generateLemmaCandidates("carried")).toContain("carry");
    expect(generateLemmaCandidates("carries")).toContain("carry");
  });

  it("reverses e-drop -ing (making → make)", () => {
    expect(generateLemmaCandidates("making")).toContain("make");
  });

  it("reverses -ves plurals (knives → knife)", () => {
    expect(generateLemmaCandidates("knives")).toContain("knife");
    expect(generateLemmaCandidates("leaves")).toContain("leaf");
  });

  it("maps irregular verb forms to their base (went → go)", () => {
    expect(generateLemmaCandidates("went")).toContain("go");
    expect(generateLemmaCandidates("swam")).toContain("swim");
  });

  it("varies only the first token of a phrase (gave up → give up)", () => {
    expect(generateLemmaCandidates("gave up")).toContain("give up");
  });

  it("drops candidates unsafe for a PostgREST filter", () => {
    expect(generateLemmaCandidates("weird(selection)")).toEqual([]);
  });
});
