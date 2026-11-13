/**
 * A recogniser given noise instead of speech does not stay quiet: it invents
 * fluent text, and a multilingual model invents it in whichever language fits
 * the noise. The user sees Russian while the session is in Portuguese.
 *
 * This is the cheap half of the fix — drop text whose script cannot belong to
 * the configured language. It is deliberately conservative: it only rejects a
 * segment when *none* of its letters are in the expected script, so a Portuguese
 * transcript with a Cyrillic name still passes. Roman-script hallucinations
 * (English noise under a `pt` hint) are not caught here and need real VAD.
 */

const SCRIPTS: Record<string, [number, number][]> = {
  latin: [
    [0x0041, 0x005a],
    [0x0061, 0x007a],
    [0x00c0, 0x024f],
    [0x1e00, 0x1eff],
  ],
  cyrillic: [[0x0400, 0x04ff]],
  greek: [[0x0370, 0x03ff]],
  arabic: [
    [0x0600, 0x06ff],
    [0x0750, 0x077f],
  ],
  hebrew: [[0x0590, 0x05ff]],
  devanagari: [[0x0900, 0x097f]],
  han: [
    [0x4e00, 0x9fff],
    [0x3400, 0x4dbf],
  ],
  kana: [[0x3040, 0x30ff]],
  hangul: [
    [0xac00, 0xd7af],
    [0x1100, 0x11ff],
  ],
  thai: [[0x0e00, 0x0e7f]],
}

const LATIN = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
  'cs',
  'sk',
  'hu',
  'ro',
  'hr',
  'sl',
  'lv',
  'lt',
  'et',
  'fi',
  'sv',
  'da',
  'vi',
  'tr',
  'id',
  'ms',
  'ca',
  'gl',
  'eu',
  'sq',
  'is',
  'no',
  'nb',
  'nn',
]

/** Which scripts a language can legitimately be written in. */
const LANGUAGE_SCRIPTS: Record<string, string[]> = Object.fromEntries([
  ...LATIN.map((l) => [l, ['latin']]),
  ...['ru', 'uk', 'bg', 'sr', 'mk', 'be'].map((l) => [l, ['cyrillic']]),
  ...['el', 'gr'].map((l) => [l, ['greek']]),
  ...['ar', 'fa', 'ur'].map((l) => [l, ['arabic']]),
  ...['he', 'yi'].map((l) => [l, ['hebrew']]),
  ...['hi', 'mr', 'ne'].map((l) => [l, ['devanagari']]),
  ...['zh', 'ja'].map((l) => [l, ['han', 'kana']]),
  ...['ko'].map((l) => [l, ['hangul']]),
  ...['th'].map((l) => [l, ['thai']]),
])

function scriptOf(code: number): string | null {
  for (const [name, ranges] of Object.entries(SCRIPTS)) {
    for (const [lo, hi] of ranges) {
      if (code >= lo && code <= hi) return name
    }
  }
  return null
}

/**
 * True when the text could have been written in `language`. Unknown languages
 * and `auto` always pass: the check is a guard against obvious nonsense, not a
 * language identifier.
 */
export function scriptMatchesLanguage(text: string, language: string | undefined): boolean {
  if (!language || language === 'auto') return true
  const expected = LANGUAGE_SCRIPTS[language.split('-')[0].toLowerCase()]
  if (!expected) return true

  const counts = new Map<string, number>()
  for (const char of text) {
    const script = scriptOf(char.codePointAt(0) ?? 0)
    if (script) counts.set(script, (counts.get(script) ?? 0) + 1)
  }
  if (counts.size === 0) return true // no letters at all: nothing to judge

  return expected.some((script) => (counts.get(script) ?? 0) > 0)
}
