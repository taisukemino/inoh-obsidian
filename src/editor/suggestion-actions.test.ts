import { describe, expect, it } from "vitest";
import { pickNextSuggestion } from "./suggestion-actions";

// pickNextSuggestion only reads `from`; a bare range is enough for the tests.
const at = (from: number) => ({ from });

describe("pickNextSuggestion", () => {
  it("returns null when nothing is pending", () => {
    expect(pickNextSuggestion([], 10)).toBeNull();
  });

  it("picks the first suggestion at or after the cursor", () => {
    const suggestions = [at(5), at(20), at(40)];
    expect(pickNextSuggestion(suggestions, 10)).toEqual(at(20));
    expect(pickNextSuggestion(suggestions, 20)).toEqual(at(20));
  });

  it("wraps to the earliest suggestion when the cursor is past them all", () => {
    expect(pickNextSuggestion([at(5), at(20)], 30)).toEqual(at(5));
  });

  it("works in document order even when the input is unordered", () => {
    // Ranges arrive in server-response order, not document order.
    expect(pickNextSuggestion([at(40), at(5), at(20)], 0)).toEqual(at(5));
    expect(pickNextSuggestion([at(40), at(5), at(20)], 10)).toEqual(at(20));
  });

  it("picks the suggestion under the cursor start", () => {
    expect(pickNextSuggestion([at(0)], 0)).toEqual(at(0));
  });
});
