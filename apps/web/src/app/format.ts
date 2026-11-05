export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
export function ms(n: number) {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}초`;
}
export function saving(before: number, after: number) {
  if (!before) return null;
  const p = Math.round((1 - after / before) * 100);
  return p;
}
