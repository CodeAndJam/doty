import { describe, expect, it } from 'vitest'
import { discoveredUrl, type HaMdnsService } from './home-assistant-discovery'

describe('discoveredUrl', () => {
  it('prefers the URL Home Assistant advertises in its TXT record', () => {
    const service: HaMdnsService = { name: 'Home', port: 8123, txt: { base_url: 'http://ha.local:8123/' } }
    expect(discoveredUrl(service)).toBe('http://ha.local:8123')
  })

  it('falls back to the service host and port', () => {
    expect(discoveredUrl({ name: 'Home', host: 'homeassistant.local', port: 8123 })).toBe(
      'http://homeassistant.local:8123',
    )
  })

  it('assumes the default port when the answer has none', () => {
    expect(discoveredUrl({ name: 'Home', host: 'home.local' })).toBe('http://home.local:8123')
  })
})
