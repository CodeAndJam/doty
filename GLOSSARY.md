# Doty

Music recommendation for tabletop RPG sessions: it listens to the table, understands the moment
of play, and picks the track that fits.

## Language

**Decision model**:
A model that answers a fixed, typed question about a piece of text by scoring a preset list of
options — a choice, a score, a yes/no — in a single forward pass, and never generates text.
Its answers are calibrated probabilities, so a low top probability is a real signal of uncertainty.
_Avoid_: classifier, LLM, small language model

**Scene interpreter** — retired:
The generative model that read the recent transcript and wrote a free-form scene description plus a
mood, an intensity and keywords. Nothing in the app produces that description now.
_Avoid_: decision model (it was never one)

**Candidate**:
A track offered as a possible answer to "what should play now". A candidate is chosen by a cheap
prefilter — keyword, tag, BPM, energy — never by a model.
_Avoid_: result, suggestion

**Ranker**:
The model that orders the candidates for the current moment of play. It answers one question: which
of these candidates best fits what is happening at the table.
_Avoid_: reranker, scorer, cross-encoder

**Recommendation**:
A ranked set of candidates plus a confidence, offered to the user.
_Avoid_: suggestion, playlist

**Lane**:
Which shelf a file belongs on: the score, or the effects. A label, not a folder — resolved from the
DM's switch, then the classifier (audio verdict first, then duration/genre/name), then the folder
the file came from. Folders are only sources, and one folder may hold both lanes.
_Avoid_: kind, type, category (the effects folder's own subfolder), library, speaker, stream

**Override** — retired as a mode:
The table taking playback by hand no longer silences the ranker: suggestions keep arriving and
autopilot changes only at a boundary. Only the metric survives — `overrideRate` is the share of
acted-on decisions the DM replaced.
_Avoid_: manual mode, autopilot off, resume auto

**Speaker**:
A person whose speech appears in the transcript: the DM, or one participant of the Discord voice
channel the bot is in. One speaker is one capture source.
_Avoid_: lane, channel, stream, voice

**Capture mode**:
Which speakers the current recording takes in: `local`, the DM's microphone only, or `all`, the
microphone plus every Discord participant.
_Avoid_: listen mode, record mode, monitor

**Session Scene**:
Doty's reading of the moment of play: a mood, an intensity, and the confirmation behind them. It
causes an Area Preset but is not the same thing.
_Avoid_: scene, state, ambience (the mood is one field of it)

## Smart home

**Area**:
A room in the DM's Home Assistant. It is the unit a session plays in, the only room Doty asks
about, and the boundary of every light Doty may touch.
_Avoid_: room, division, zone, place

**Light**:
A Home Assistant light entity inside the session's Area. The first device class Doty can act on,
not the last.
_Avoid_: bulb, lamp, device, fixture

**Area Preset**:
The fixed light state a mood maps to across the whole Area. Doty writes it; the DM may take it back
by hand. The Session Scene's mood is the default producer, a Session Hint the other one.
_Avoid_: scene, theme, palette, mood lighting

**Session Hint**:
The DM's own words about the moment of play, pinned beside the rolling transcript and read by the
music, the effects and the lights alike. It nudges; the transcript still decides.
_Avoid_: prompt, cue, note, scene description, static prompt

**Playback Device**:
A Home Assistant entity that plays audio. Not integrated yet; named now so that a smart speaker is
never called a Speaker.
_Avoid_: speaker, media player, output, stream
