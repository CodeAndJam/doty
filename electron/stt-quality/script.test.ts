import { describe, expect, it } from 'vitest'
import { scriptMatchesLanguage } from './script'

describe('scriptMatchesLanguage', () => {
  it('accepts Portuguese written in Latin script', () => {
    expect(scriptMatchesLanguage('O dragão ergue-se das ruínas e ruge.', 'pt')).toBe(true)
    expect(scriptMatchesLanguage('Rolar iniciativa', 'pt-PT')).toBe(true)
  })

  it('rejects Cyrillic noise under a Portuguese session', () => {
    // The reported symptom: a quiet room decoded as Russian.
    expect(scriptMatchesLanguage('Вечерщина. Чука, чука. Натюрати.', 'pt')).toBe(false)
  })

  it('rejects Latin noise under a Russian session', () => {
    expect(scriptMatchesLanguage('Yeah, it is trying to make things', 'ru')).toBe(false)
  })

  it('lets a foreign name through when the session language is present', () => {
    expect(scriptMatchesLanguage('O dragão chamava-se Вечерщина', 'pt')).toBe(true)
  })

  it('says nothing about text with no letters', () => {
    expect(scriptMatchesLanguage('... 42 !?', 'pt')).toBe(true)
    expect(scriptMatchesLanguage('', 'ru')).toBe(true)
  })

  it('passes when the language is unknown or auto', () => {
    expect(scriptMatchesLanguage('Вечерщина', 'auto')).toBe(true)
    expect(scriptMatchesLanguage('Вечерщина', undefined)).toBe(true)
    expect(scriptMatchesLanguage('Вечерщина', 'xx')).toBe(true)
  })

  it('knows the multi-script languages', () => {
    expect(scriptMatchesLanguage('こんにちは世界', 'ja')).toBe(true)
    expect(scriptMatchesLanguage('你好世界', 'ja')).toBe(true)
    expect(scriptMatchesLanguage('안녕하세요', 'ko')).toBe(true)
    expect(scriptMatchesLanguage('안녕하세요', 'ja')).toBe(false)
    expect(scriptMatchesLanguage('Καλημέρα', 'el')).toBe(true)
  })
})
