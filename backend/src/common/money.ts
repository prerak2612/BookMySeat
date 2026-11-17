/** Money helpers. Amounts are kept in rupees with 2 decimals; rounding happens in one place. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
