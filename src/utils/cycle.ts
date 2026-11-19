/** Returns the item `step` places after `current` in `items`, wrapping around in both directions. */
export function cycle<T>(items: readonly T[], current: T, step: number): T {
  if (items.length === 0) throw new Error('cycle() requires a non-empty list');
  const index = items.indexOf(current);
  const base = index < 0 ? (step > 0 ? -1 : 0) : index;
  const next = (((base + step) % items.length) + items.length) % items.length;
  return items[next] as T;
}
