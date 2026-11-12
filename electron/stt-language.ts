/**
 * Turn the persisted language preference into the locale a model accepts.
 * Returns undefined for auto-detect (the model decides per utterance).
 */
export function resolveLanguage(requested: string | undefined, supported: string[]): string | undefined {
  if (!requested || requested === 'auto') return undefined
  if (supported.includes(requested)) return requested

  const base = requested.split('-')[0].toLowerCase()
  // Doty is pt-PT first: `pt` should mean Portugal, not Brazil.
  if (base === 'pt') {
    const ptPt = supported.find((l) => l.toLowerCase() === 'pt-pt')
    if (ptPt) return ptPt
  }
  return supported.find((l) => l.split('-')[0].toLowerCase() === base)
}
