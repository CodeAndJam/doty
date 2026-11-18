/** The label the mic lane gets once a session holds more than one voice. */
export const DM_SPEAKER = 'dm'

/**
 * The name to put in front of a transcript line, or null when there is only one
 * voice in the log and a label would be noise. Screen, clipboard and export all
 * read it from here so they cannot disagree.
 */
export function speakerPrefix(speaker: string | undefined, multiSpeaker: boolean): string | null {
  if (speaker) return speaker
  return multiSpeaker ? DM_SPEAKER : null
}
