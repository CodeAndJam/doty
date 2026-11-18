/**
 * Mood → light. A table, not a model: a wrong guess costs one dull colour, and
 * a table can be read in one glance. Lives in `src/lib` because the panel draws
 * the same swatches the director sends to Home Assistant.
 */

export type Rgb = [number, number, number]

export interface Preset {
  /** Home Assistant `rgb_color`. */
  rgb: Rgb
  /** Home Assistant `brightness_pct`. */
  brightnessPct: number
}

/** The 13 moods, in the order the decision model scores them. */
export const MOODS = [
  'combat',
  'chase',
  'tense',
  'horror',
  'mystery',
  'exploration',
  'tavern',
  'celebration',
  'sad',
  'epic',
  'peaceful',
  'voyage',
  'stealth',
]

const PALETTE: Record<string, Rgb> = {
  combat: [200, 30, 25],
  chase: [230, 90, 20],
  tense: [150, 70, 35],
  horror: [20, 30, 60],
  mystery: [70, 50, 130],
  exploration: [240, 190, 110],
  tavern: [255, 170, 80],
  celebration: [255, 210, 120],
  sad: [90, 110, 140],
  epic: [255, 235, 200],
  peaceful: [200, 220, 200],
  voyage: [110, 160, 200],
  stealth: [40, 55, 70],
}

/** Perceived brightness stays above 20 %: a dark room is not a lit room. */
export function presetFor(mood: string, intensity: number): Preset {
  const rgb = PALETTE[mood] ?? PALETTE.exploration
  const level = Math.min(1, Math.max(0, intensity))
  return { rgb: [...rgb] as Rgb, brightnessPct: Math.round(20 + level * 80) }
}

/**
 * The Session Hint's mood, when its words name one. Keyword matching is the
 * floor under the model path, and it is what the prototype uses: one text for
 * three panes is cheap to start with, and the log rows say if it was worth it.
 */
const HINT_WORDS: Array<[string, string[]]> = [
  ['combat', ['combat', 'fight', 'battle', 'briga', 'luta', 'batalha']],
  ['chase', ['chase', 'pursuit', 'running', 'fuga', 'perseguição']],
  ['horror', ['horror', 'terrifying', 'dread', 'terror', 'medo']],
  ['tense', ['tense', 'tension', 'standoff', 'tenso', 'tensão']],
  ['mystery', ['mystery', 'clue', 'investigate', 'mistério', 'investigar']],
  ['stealth', ['stealth', 'sneak', 'hide', 'furtivo', 'esconder']],
  ['celebration', ['celebrate', 'party', 'feast', 'festival', 'festa', 'celebrar']],
  ['tavern', ['tavern', 'inn', 'pub', 'drink', 'taberna', 'estalagem']],
  ['voyage', ['sea', 'ship', 'sail', 'ocean', 'mar', 'navio', 'viagem']],
  ['exploration', ['explore', 'journey', 'forest', 'feywild', 'adventure', 'explorar', 'floresta']],
  ['epic', ['epic', 'heroic', 'triumphant', 'épico', 'heroico', 'triunfal']],
  ['sad', ['sad', 'grief', 'mourn', 'loss', 'triste', 'luto', 'perda']],
  ['peaceful', ['peaceful', 'calm', 'quiet', 'rest', 'calmo', 'tranquilo', 'descanso']],
]

export function moodFromHint(hint: string): string | null {
  const text = hint.toLowerCase()
  for (const [mood, words] of HINT_WORDS) {
    if (words.some((word) => text.includes(word))) return mood
  }
  return null
}
