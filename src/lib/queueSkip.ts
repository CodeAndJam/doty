/**
 * Where N/P in the queue lands, or -1 when there is nowhere to go without wrapping.
 * `index` is -1 while the DM hears a track outside the queue: N starts the head,
 * P has nowhere to go.
 */
export function skipTarget(index: number, length: number, step: 1 | -1, wrap: boolean): number {
  if (length === 0) return -1
  const next = index + step
  if (next >= 0 && next < length) return next
  return wrap ? (next < 0 ? length - 1 : 0) : -1
}
