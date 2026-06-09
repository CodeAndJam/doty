/**
 * Pre-filter candidates by keyword matching on filenames and tags
 * to reduce the number of tracks scored by the cross-encoder.
 */
export function prefilterCandidates(
  transcript: string,
  files: string[],
  tagsMap: Record<string, string[]> = {},
  maxCandidates = 100,
): string[] {
  if (files.length <= maxCandidates) return files

  // Extract keywords from transcript (2+ char words)
  const keywords = transcript
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2)

  if (keywords.length === 0) return files.slice(0, maxCandidates)

  // Score each file by keyword matches in filename and tags
  const scored = files.map((file) => {
    const name = file.toLowerCase()
    const tags = (tagsMap[file] || []).map((t) => t.toLowerCase()).join(' ')
    const searchable = `${name} ${tags}`
    let score = 0
    for (const kw of keywords) {
      if (searchable.includes(kw)) score++
    }
    return { file, score }
  })

  // Sort by score descending, take top maxCandidates
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxCandidates).map((s) => s.file)
}
