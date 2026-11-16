import { describe, expect, it } from 'vitest'
import { hintFromLangId, LANGID_CONFIDENCE, preferredCodes, rejectsLanguage, resolveLanguage } from './stt-language'

const NEMOTRON = ['en-US', 'en-GB', 'es-US', 'es-ES', 'fr-FR', 'it-IT', 'pt-BR', 'pt-PT', 'de-DE']

describe('resolveLanguage', () => {
  it('uses the exact locale when the model supports it', () => {
    expect(resolveLanguage('pt-PT', NEMOTRON)).toBe('pt-PT')
    expect(resolveLanguage('pt-BR', NEMOTRON)).toBe('pt-BR')
  })

  it('maps a base pt code to pt-PT, not pt-BR', () => {
    expect(resolveLanguage('pt', NEMOTRON)).toBe('pt-PT')
  })

  it('maps other base codes to the first matching locale', () => {
    expect(resolveLanguage('en', NEMOTRON)).toBe('en-US')
    expect(resolveLanguage('fr', NEMOTRON)).toBe('fr-FR')
  })

  it('returns undefined for auto and for unsupported languages', () => {
    expect(resolveLanguage('auto', NEMOTRON)).toBeUndefined()
    expect(resolveLanguage(undefined, NEMOTRON)).toBeUndefined()
    expect(resolveLanguage('ja', NEMOTRON)).toBeUndefined()
  })

  it('works with short-code models', () => {
    expect(resolveLanguage('pt', ['en', 'pt', 'es'])).toBe('pt')
  })
})

describe('preferredCodes', () => {
  it('reduces a locale to the two-letter code language ID uses', () => {
    expect(preferredCodes('pt-PT')).toEqual(['pt'])
    expect(preferredCodes('en-GB')).toEqual(['en'])
  })

  it('accepts everything on auto', () => {
    // Nothing was asked for, so nothing may be rejected.
    expect(preferredCodes('auto')).toEqual([])
    expect(preferredCodes(undefined)).toEqual([])
  })
})

describe('rejectsLanguage', () => {
  const pt = preferredCodes('pt-PT')

  it('keeps the label the session asked for', () => {
    expect(rejectsLanguage({ code: 'pt', probability: 0.99 }, pt)).toBe(false)
  })

  it('rejects a confident label from another language', () => {
    expect(rejectsLanguage({ code: 'en', probability: 0.92 }, pt)).toBe(true)
  })

  it('never rejects below the confidence bar', () => {
    // Measured: music, pink noise and silence score 0.004-0.035 on their best
    // label, and short real phrases score 0.5-0.6 on the wrong one.
    expect(rejectsLanguage({ code: 'en', probability: LANGID_CONFIDENCE - 0.01 }, pt)).toBe(false)
    expect(rejectsLanguage({ code: 'en', probability: 0.035 }, pt)).toBe(false)
  })

  it('never rejects when no language was chosen', () => {
    expect(rejectsLanguage({ code: 'en', probability: 0.99 }, preferredCodes('auto'))).toBe(false)
  })

  it('keeps text when the model returned nothing', () => {
    expect(rejectsLanguage({ code: null, probability: 0 }, pt)).toBe(false)
  })
})

describe('hintFromLangId', () => {
  it('resolves a confident label to a locale the model accepts', () => {
    expect(hintFromLangId({ code: 'pt', probability: 0.9 }, NEMOTRON)).toBe('pt-PT')
    expect(hintFromLangId({ code: 'fr', probability: 0.9 }, NEMOTRON)).toBe('fr-FR')
  })

  it('declines an unsure label and an unsupported one', () => {
    expect(hintFromLangId({ code: 'fr', probability: 0.57 }, NEMOTRON)).toBeUndefined()
    expect(hintFromLangId({ code: 'ja', probability: 0.9 }, NEMOTRON)).toBeUndefined()
    expect(hintFromLangId({ code: null, probability: 0 }, NEMOTRON)).toBeUndefined()
  })
})
