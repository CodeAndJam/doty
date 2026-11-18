/**
 * Names for the remote lane. A label is frozen the first time a speaker is
 * heard, so a mid-session rename cannot rewrite what is already in the
 * transcript, and two people with the same display name stay distinguishable.
 */
export class SpeakerLabels {
  private readonly byUser = new Map<string, string>()
  private readonly used = new Map<string, number>()
  private unnamed = 0

  label(userId: string, raw: string): string {
    const existing = this.byUser.get(userId)
    if (existing) return existing

    const name = raw.trim()
    let value: string
    if (name) {
      const seen = (this.used.get(name) ?? 0) + 1
      this.used.set(name, seen)
      value = seen === 1 ? name : `${name} (${seen})`
    } else {
      this.unnamed += 1
      value = `Remote ${this.unnamed}`
    }
    this.byUser.set(userId, value)
    return value
  }

  reset(): void {
    this.byUser.clear()
    this.used.clear()
    this.unnamed = 0
  }
}
