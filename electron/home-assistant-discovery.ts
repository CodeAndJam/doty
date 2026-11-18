/**
 * Finding the DM's Home Assistant on the LAN.
 *
 * Home Assistant publishes `_home-assistant._tcp` with its name and URLs in the
 * TXT record. mDNS is link-local, so a proxy or a VLAN hides the instance; that
 * is what the manual address field is for.
 */
import { Bonjour } from 'bonjour-service'

export interface DiscoveredHomeAssistant {
  name: string
  url: string
}

/** The fields of an mDNS answer this feature depends on. */
export interface HaMdnsService {
  name: string
  host?: string
  port?: number
  txt?: Record<string, unknown>
}

export function discoveredUrl(service: HaMdnsService): string {
  const txt = service.txt ?? {}
  const advertised = txt.base_url ?? txt.internal_url
  if (typeof advertised === 'string' && advertised.length > 0) return advertised.replace(/\/+$/, '')
  const host = service.host ?? service.name
  return `http://${host}:${service.port ?? 8123}`
}

export function discoverHomeAssistants(timeoutMs = 3000): Promise<DiscoveredHomeAssistant[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour()
    const found = new Map<string, DiscoveredHomeAssistant>()
    const browser = bonjour.find({ type: 'home-assistant' }, (service) => {
      const url = discoveredUrl(service as HaMdnsService)
      found.set(url, { name: service.name, url })
    })
    // No live test: mDNS needs a responder on the machine running the tests.
    // The client itself is tested against a fake Home Assistant over a socket.
    setTimeout(() => {
      browser.stop()
      bonjour.destroy()
      resolve([...found.values()])
    }, timeoutMs)
  })
}
