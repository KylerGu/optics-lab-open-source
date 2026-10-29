/** Compact display only; callers retain the original number for calculation. */
export function formatFormulaNumber(value: number): string {
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '−∞';
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (value !== 0 && (magnitude >= 1e6 || magnitude < 1e-4)) {
    const [mantissa, exponent] = value.toExponential(3).split('e');
    return `${Number(mantissa)}e${exponent}`;
  }
  return String(Number(value.toFixed(4)));
}

export function formatFormulaInput(value: string): string {
  if (!value.trim()) return '';
  const number = Number(value);
  return Number.isFinite(number) ? formatFormulaNumber(number) : '';
}
