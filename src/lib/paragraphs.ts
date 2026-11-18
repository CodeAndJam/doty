/**
 * Group transcript segments into paragraphs.
 *
 * A change of speaker ends the paragraph — two voices interleaved in one block
 * read as one person, which is the whole failure the speaker labels exist to
 * prevent.
 */
export interface TranscriptLine {
  text: string
  speaker?: string
  system?: boolean
  paragraphStart?: boolean
}

export function groupParagraphs<T extends TranscriptLine>(segments: T[]): T[][] {
  const paragraphs: T[][] = []
  let current: T[] = []
  for (const seg of segments) {
    const speakerChanged = current.length > 0 && current[0].speaker !== seg.speaker
    if (seg.system || seg.paragraphStart || speakerChanged) {
      if (current.length > 0) {
        paragraphs.push(current)
        current = []
      }
      if (seg.system) paragraphs.push([seg])
      else current.push(seg)
    } else {
      current.push(seg)
    }
  }
  if (current.length > 0) paragraphs.push(current)
  return paragraphs
}
