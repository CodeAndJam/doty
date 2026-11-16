import { describe, expect, it } from 'vitest'
import { plausibleText, scriptMatchesLanguage } from './script'

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

describe('plausibleText', () => {
  it('drops a short Portuguese segment with letters from another alphabet', () => {
    // The real session produced both of these from mumbles.
    expect(plausibleText('O presužma', 'pt')).toBe(false)
    expect(plausibleText('Stale tętrz', 'pt')).toBe(false)
  })

  it('keeps ordinary Portuguese, including accents and fillers', () => {
    expect(plausibleText('Né?', 'pt')).toBe(true)
    expect(plausibleText('Parece-vos bem ou parece-vos mal?', 'pt')).toBe(true)
  })

  it('keeps a foreign name inside a full sentence', () => {
    expect(plausibleText('O Šimek chegou à taberna e sentou-se.', 'pt')).toBe(true)
  })

  it('does not police alphabets that legitimately use those letters', () => {
    expect(plausibleText('Zażółć gęślą jaźń', 'pl')).toBe(true)
  })

  it('still rejects the wrong script', () => {
    expect(plausibleText('Привет', 'pt')).toBe(false)
  })
})
