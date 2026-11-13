/**
 * The vector arithmetic behind retrieval.
 *
 * An embedding model turns text into a direction in a few hundred dimensions:
 * "dungeon water dripping" and "sparse cave ambience" end up close together even
 * though they share no words. Everything here is plain maths on those vectors so
 * it can be tested without a model, and so the cost of retrieval is obvious:
 * a cosine over a few thousand vectors is microseconds.
 */

/** Average the token vectors the mask keeps, ignoring padding. */
export function meanPool(hidden: Float32Array | number[], mask: number[], dim: number): Float32Array {
  const out = new Float32Array(dim)
  let kept = 0
  for (let token = 0; token < mask.length; token++) {
    if (!mask[token]) continue
    kept++
    const base = token * dim
    for (let d = 0; d < dim; d++) out[d] += hidden[base + d] ?? 0
  }
  if (kept === 0) return out
  for (let d = 0; d < dim; d++) out[d] /= kept
  return out
}

/** Unit length, so a dot product is a cosine and lengths stop mattering. */
export function normalise(vector: Float32Array): Float32Array {
  let sum = 0
  for (const v of vector) sum += v * v
  const length = Math.sqrt(sum)
  if (length === 0) return vector
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / length
  return out
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return Number.isFinite(dot) ? dot : 0
}

/** The k closest tracks to a query, best first. */
export function topK(query: Float32Array, vectors: Map<string, Float32Array>, k: number): string[] {
  const scored: Array<{ path: string; score: number }> = []
  for (const [path, vector] of vectors) scored.push({ path, score: cosine(query, vector) })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(0, k)).map((s) => s.path)
}
