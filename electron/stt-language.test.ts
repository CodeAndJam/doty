import { describe, expect, it } from 'vitest'
import { resolveLanguage } from './stt-language'

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
