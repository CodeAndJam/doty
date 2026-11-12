/** Lowercase + strip diacritics so `ação` and `acao` match. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function tokenize(text: string): string[] {
  return fold(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Whether any transcript token appears in a user tag (accent-insensitive). */
export function matchesTag(tokens: string[], tag: string): boolean {
  const folded = fold(tag.toLowerCase())
  return tokens.some((t) => folded.includes(t) || t.includes(folded))
}
