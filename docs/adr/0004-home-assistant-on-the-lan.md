# Doty reaches the DM's Home Assistant, and nothing else

Doty promised that model downloads are its only network use. Lighting the room for a session breaks
that promise, so the promise is being narrowed rather than quietly broken: the app talks to exactly
one service — the DM's own Home Assistant — and only while both are on the same home network.

The session is a physical event in a physical room, and the room is already described by the DM's
own Home Assistant. Discovery is mDNS plus a manual address for the cases mDNS cannot see (reverse
proxy, VLAN, static DHCP lease), both of which stay inside the LAN. No Nabu Casa, no cloud relay, no
remote address, no telemetry: a DM who plays away from home loses the lights and keeps the music.

Access is a long-lived token pasted in Settings, encrypted at rest like the Discord token. The
consent flow Home Assistant offers is a better welcome and the same trust boundary, so it arrives in
v2 as polish on the same client, not as a different architecture.

Status: accepted

## Considered Options

- **Cloud relay or Nabu Casa.** Rejected. It would make the app reachable from outside the DM's
  network, which changes the threat model for a feature whose whole payload is "which room is the
  table in".
- **Remote URL support** (self-hosted HA behind a domain). Rejected for v1: it invites the same
  exposure, and LAN discovery already covers the case the feature exists for.
- **OAuth consent in v1.** Deferred, not rejected. Same client, same token afterwards; the paste is
  the cheaper thing to build first.

## Consequences

- `AGENTS.md`'s local-only bullet now reads as: model downloads and the DM's own Home Assistant on
  the LAN. Every future integration is judged against this ADR, not against convenience.
- Losing Home Assistant mid-session is a normal condition, not an error: playback, suggestions and
  the transcript never depend on it.
- The Home Assistant client lives in the main process beside the session pass, so the rules for
  changing an Area Preset cannot drift between processes.
