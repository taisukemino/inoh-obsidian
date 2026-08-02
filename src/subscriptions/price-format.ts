import type { PlanPrice, ProPrices } from "./subscription-service";

/** Currencies Stripe bills as whole units, so 100 means 100 yen, not 1.00. */
const ZERO_DECIMAL_CURRENCIES = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

const MONTHS_PER_YEAR = 12;

/**
 * Renders a Stripe amount in its own currency.
 *
 * @param price - Amount in the smallest currency unit, plus its currency
 * @returns A localized string such as "$7.99" or "¥1,200"
 */
export function formatPrice(price: PlanPrice): string {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(price.currency);
  const amount = isZeroDecimal ? price.unitAmount : price.unitAmount / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
    // Reason: Stripe amounts are exact, so trailing zeros belong ($8.00, not $8).
    minimumFractionDigits: isZeroDecimal ? 0 : 2,
  }).format(amount);
}

/**
 * Whole-percent saving from paying yearly instead of twelve monthly charges.
 *
 * @param prices - Live prices for both intervals
 * @returns The saving, or null when it cannot be computed or isn't a saving
 */
export function yearlySavingPercent(prices: ProPrices): number | null {
  const { month, year } = prices;
  if (!month || !year || month.currency !== year.currency) {
    return null;
  }
  const yearlyCostOfMonthly = month.unitAmount * MONTHS_PER_YEAR;
  if (yearlyCostOfMonthly <= year.unitAmount) {
    return null;
  }
  const saving = 1 - year.unitAmount / yearlyCostOfMonthly;
  const savingPercent = Math.round(saving * 100);
  // A "save 0%" badge is worse than none.
  return savingPercent > 0 ? savingPercent : null;
}

/**
 * Button label for one interval, e.g. "Yearly · $71.88 (save 25%)".
 * Falls back to the bare interval name when the price is unavailable, so the
 * upgrade path still works if Stripe cannot be reached.
 *
 * @param intervalName - Human label for the interval ("Yearly" / "Monthly")
 * @param price - That interval's price, if known
 * @param savingPercent - Saving to advertise, if any
 */
export function planButtonLabel(
  intervalName: string,
  price: PlanPrice | null,
  savingPercent: number | null = null,
): string {
  if (!price) {
    return intervalName;
  }
  const savingSuffix = savingPercent ? ` (save ${savingPercent}%)` : "";
  return `${intervalName} · ${formatPrice(price)}${savingSuffix}`;
}
