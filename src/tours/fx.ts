/**
 * Hardcoded FX reference rates (1 unit local currency → USD).
 *
 * Deliberately static — BD accuracy matters, and a stale hardcoded rate is
 * easier to audit than a silent API call. Refresh quarterly by editing this
 * file. When a currency is missing, the normalizer returns null for price_usd
 * instead of guessing, and the completeness report surfaces the gap.
 *
 * Last refreshed: 2026-04-21.
 */
export const KNOWN_FX: Record<string, number> = {
  USD: 1.0,
  US: 1.0,
  JPY: 0.0063,
  HKD: 0.128,
  HK: 0.128,
  TWD: 0.031,
  NT: 0.031,
  KRW: 0.00071,
  CNY: 0.138,
  RMB: 0.138,
  EUR: 1.075,
  GBP: 1.28,
  SGD: 0.755,
  AUD: 0.66,
  CHF: 1.12,
  THB: 0.029,
  VND: 0.000039,
  IDR: 0.000061,
  MYR: 0.225,
  PHP: 0.0175,
  INR: 0.0119,
};
