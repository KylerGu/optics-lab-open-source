export function formatNumber(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 10000) return value.toExponential(3);
  return Number(value.toPrecision(5)).toString();
}
