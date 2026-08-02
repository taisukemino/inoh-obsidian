import { describe, expect, it } from "vitest";
import { formatPrice, planButtonLabel, yearlySavingPercent } from "./price-format";

const usd = (unitAmount: number) => ({ unitAmount, currency: "usd" });

describe("formatPrice", () => {
  it("renders cents as a decimal amount", () => {
    expect(formatPrice(usd(799))).toBe("$7.99");
  });

  it("keeps trailing zeros, since Stripe amounts are exact", () => {
    expect(formatPrice(usd(800))).toBe("$8.00");
  });

  it("treats zero-decimal currencies as whole units", () => {
    // 1200 JPY is ¥1,200, not ¥12.
    expect(formatPrice({ unitAmount: 1200, currency: "jpy" })).toBe("¥1,200");
  });
});

describe("yearlySavingPercent", () => {
  it("computes the saving against twelve monthly charges", () => {
    // 7188 vs 799 * 12 = 9588 → 25% off.
    expect(yearlySavingPercent({ month: usd(799), year: usd(7188) })).toBe(25);
  });

  it("returns null when either price is missing", () => {
    expect(yearlySavingPercent({ month: usd(799), year: null })).toBeNull();
    expect(yearlySavingPercent({ month: null, year: usd(7188) })).toBeNull();
  });

  it("returns null when yearly is not actually cheaper", () => {
    expect(yearlySavingPercent({ month: usd(799), year: usd(9588) })).toBeNull();
    expect(yearlySavingPercent({ month: usd(799), year: usd(11000) })).toBeNull();
  });

  it("returns null when the currencies differ, rather than comparing nonsense", () => {
    expect(
      yearlySavingPercent({ month: usd(799), year: { unitAmount: 7188, currency: "eur" } }),
    ).toBeNull();
  });

  it("suppresses a saving that rounds to zero", () => {
    expect(yearlySavingPercent({ month: usd(799), year: usd(9580) })).toBeNull();
  });
});

describe("planButtonLabel", () => {
  it("includes the price and the saving", () => {
    expect(planButtonLabel("Yearly", usd(7188), 25)).toBe("Yearly · $71.88 (save 25%)");
  });

  it("omits the saving when there is none", () => {
    expect(planButtonLabel("Monthly", usd(799))).toBe("Monthly · $7.99");
  });

  it("falls back to the bare interval when the price is unknown", () => {
    expect(planButtonLabel("Monthly", null)).toBe("Monthly");
  });
});
