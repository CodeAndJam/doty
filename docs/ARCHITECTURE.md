# Architecture

How Doty turns a room full of talking into a soundtrack. Four pipelines, one
process boundary each, and every expensive step either in a worker or behind a
model that can be missing without stopping playback.

Reading order: [process map](#process-map) → [audio to transcript](#audio-to-transcript)
→ [transcript to a music decision](#transcript-to-a-music-decision) →
[library, index and search](#library-index-and-search) → [data](#data) →
[degradation](#degradation).

## Process map

Three processes, one database, and models that are files on disk.

```mermaid
flowchart LR
  subgraph renderer["Renderer — React"]
    UI[Soundboard · Browse · Settings · Transcript]
    REC[useRecorder<br/>16 kHz PCM]
    RANK[rankTracks<br/>candidate prefilter]
    AP[useAutopilot<br/>countdown transitions]
    PLAY[Player · SFX player]
  end

  subgraph preload["Preload"]
    API["window.doty<br/>typed IPC bridge"]
  end

  subgraph main["Main — Electron"]
    LIB[library<br/>membership · lanes · vectors]
    DIR[session pass<br/>scene · policy]
    ASRF[STT fan-out<br/>WAV + VTT writer]
    DB[(SQLite doty.db)]
    FS[(Music · SFX · sessions)]
  end

  subgraph workers["worker_threads"]
    STT[transcribe-worker<br/>VAD + decoder]
    RK[ranker-worker<br/>d1-omni]
  end

  MODELS[(~/.doty/models<br/>STT · VAD · embedder · ranker)]

  UI <--> API
  API <--> main
  REC -->|0.5 s PCM| API
  API --> ASRF
  ASRF --> STT
  STT -->|flush text| ASRF
  ASRF -->|stt:transcript| API
  API --> UI

  RANK -->|rankerDecide| API
  API --> RK
  UI -->|sessionEvaluate| API
  API --> DIR
  DIR --> DB
  RANK --> AP
  AP --> PLAY
  UI --> PLAY

  LIB --> DB
  LIB --> FS
  LIB --> MODELS
  STT --> MODELS
  RK --> MODELS
  RANK -->|librarySearch| API
  API --> LIB
```

## Audio to transcript

Two copies of the same audio: one is the recording, one is the transcript. They
diverge on purpose — the WAV is the raw room, the transcript is VAD-gated speech.

```mermaid
flowchart TD
  MIC[Microphone<br/>getUserMedia: mono, 16 kHz<br/>echo cancel · noise suppress · AGC]
  WORKLET[AudioWorklet pcm-capture<br/>posts a 0.5 s Float32Array]
  IPC1[IPC sttTranscribeChunk]
  WAV[(session-*.wav<br/>raw PCM at byte 44)]
  FEED[feedChunk]
  GATE{Silero VAD<br/>SpeechGate}
  BATCH{decoder kind}
  CHUNK[ChunkBuffer<br/>≈10 s windows<br/>close after 800 ms pause<br/>flush after 3 s pause]
  LIVE[stream feed<br/>160 ms pieces]
  DECODE[transcribe.cpp<br/>Parakeet / Nemotron / Whisper]
  FILTER[plausibleText<br/>script + invented-word guard]
  VTT[(session-*.vtt<br/>NOTE: name, created)]
  EVENT[event stt:transcript]
  UI[Renderer transcript<br/>and rolling 800-char buffer]

  MIC --> WORKLET --> IPC1
  IPC1 --> WAV
  IPC1 --> FEED --> GATE
  GATE -->|speech| BATCH
  BATCH -->|batch model| CHUNK --> DECODE
  BATCH -->|streaming model| LIVE --> DECODE
  GATE -->|session end| DECODE
  DECODE --> FILTER
  FILTER -->|kept| VTT
  FILTER -->|kept| EVENT --> UI
```

Why the buffer exists: a batch model handed one VAD phrase at a time has nothing
but its language prior to fill the silence, and it fills it with words nobody
said. Seen on a real session: “Resurrê? O presužma”, “Gareth”. The same audio
decoded as a 15 s window is clean.

### Discord participants

A second capture source, off unless the DM turns it on. `selfDeaf: false` was
already set, so `connection.receiver` delivers each participant's Opus stream;
prism decodes it, ffmpeg resamples 48 kHz stereo to 16 kHz mono, and the whole
speech burst (Discord's 1.2 s silence boundary) is decoded at once by a worker of
its own. Batch-per-utterance is deliberate: one compute in flight per model means
per-speaker streaming needs a model per head, and an utterance decoded whole is
both cheaper and the shape `ChunkBuffer` already proved better than short frames.
Cues are written as WebVTT voice spans (`<v Ana>…</v>`), so one session file stays
valid for any player, and `loadSessionAsync` reads the tag back into a speaker.
The lane's audio is written beside the mic's take as `session-…-remote.wav`,
opened on the first remote utterance so a mic-only session leaves no empty file.
The same cues can be mirrored into the channel's own text chat: lines are
batched for two seconds and packed into as few messages as Discord's 2000-char
limit allows, because a channel rate limit turns one line per message into spam.

## Transcript to a music decision

Two authorities, by design, and only one of them runs at a time.

```mermaid
flowchart TD
  T[New final transcript] --> BUF[rolling buffer, last 800 chars]
  BUF --> DEB[debounce 1.5 s]
  DEB --> RANK[rankTracks]

  RANK --> LANE{label is sfx?}
  LANE -->|yes| DROP[not a candidate]
  LANE -->|no| CAND[candidateSet<br/>keyword · tags · BPM · energy<br/>20 slots]
  CAND --> MODEL{decision model loaded?}
  MODEL -->|no| HEUR[heuristic scores<br/>ranker = heuristic]
  MODEL -->|yes| RKP[ranker-worker: d1-omni<br/>rank prompt against 20 descriptions]
  RKP --> PROB[calibrated probabilities<br/>ranker = model]

  PROB --> UI[Recommendation list + confidence]
  UI --> NEAR{track ending in ≤ 21 s?}
  NEAR -->|no| WAIT[wait]
  NEAR -->|yes| EVAL[sessionEvaluate]

  EVAL --> PASS[session pass]
  PASS --> MOOD[d1-omni evaluate<br/>scene mood + track probability]
  MOOD --> FOLD[foldScene<br/>hysteresis, dwell]
  FOLD --> POLICY[decideAction<br/>boundary 0.40 & 1.5x · categorical 0.30<br/>cut-in 0.90 & 2x · dwell 60 s]
  POLICY --> PLAN[plan: hold · queue-next · play-now]

  PLAN -->|hold| LOG[decision log, max 1 per 30 s]
  PLAN -->|queue-next| QUEUE[queue the pick<br/>DM's hand-queued track wins]
  PLAN -->|play-now| CUT[cut in]
  QUEUE --> PLAY[Player]
  CUT --> PLAY

  HEUR -.->|legacy path only| AP[useAutopilot<br/>confidence countdown]
  AP --> PLAY
```

The split matters: the model path is planned by the **session pass** (main), so
the rules cannot drift between processes. `useAutopilot` only takes over when the
decision model is unavailable — two authorities at once would let one replace a
track mid-phrase.

Suggestions never stop. A manual pick is a label recorded in
`session_preferences`; it does not silence the ranker, and it never causes a
mid-track cut.

## Library, index and search

The library is one module. Before it, five call sites each rebuilt “files, then
metadata, then tags, then a describer”, and two disagreed about which folder
counted.

```mermaid
flowchart TD
  MF[(musicFolder)] --> ITEMS
  SF[(sfxFolder — may be the same folder)] --> ITEMS
  ITEMS[library.items<br/>key · path · absolute · lane · description]

  ITEMS --> LANES[lane resolution<br/>override > classifier > folder]
  ITEMS --> DESC[describeTrack<br/>folder taxonomy + tempo · mode · length · energy]
  ITEMS --> TXT[text pass<br/>EmbeddingGemma, batches of 8]
  ITEMS --> AUD[audio pass<br/>ffmpeg clip → mel → audio encoder]

  TXT --> VEC[(track_vectors<br/>key, model, dim)]
  AUD --> KIND[classify vs two anchors<br/>music vs not]
  KIND --> VEC

  Q[search text] --> EMBED[embedQuery]
  EMBED --> FULL{all items on this lane<br/>have a vector?}
  FULL -->|yes| TOPK[topK cosine]
  TOPK --> PIN[pin exact name/tag matches first]
  FULL -->|no| LOWER[lowercase · all tokens must appear]
  PIN --> RES[items + mode: semantic]
  LOWER --> RES2[items + mode: text]

  VEC --> TOPK
  KIND -->|audio verdict| LANES
  DESC -->|name, tags| LOWER
```

Indexing is one run with two reported phases (`text`, then `audio`), and it
**pauses while the microphone is recording**: the transcript is the critical
path, and the index is minutes of model work. It resumes when recording stops.

Lane resolution, in isolation:

```mermaid
flowchart LR
  O{DM override?} -->|yes| OL[label it]
  O -->|no| A{audio verdict?}
  A -->|yes| CL[classifier wins]
  A -->|no| G{genre says effects?}
  G -->|yes| CL
  G -->|no| C{duration ≤ 20 s or ≥ 45 s?}
  C -->|yes| CL
  C -->|no| N{name says sfx/music?}
  N -->|yes| CL
  N -->|no| F[folder it came from]
```

Each pane searches what it lists, and both use the same retrieval index: the music
pane offers the tracks the music list shows (an effect only when no effects folder
is configured to hold it), the effects pane offers everything labelled an effect.
A search box that answers about a different set than the list under it is a bug,
which is what made "air" miss a wind effect the model ranked first.

## Data

```mermaid
erDiagram
  tracks ||--o{ track_tags : "filename"
  tracks {
    text path PK
    real duration
    real bpm
    text scale
    real energy
    real loudness
    int analysis_version
  }
  track_tags {
    text filename PK
    text tag PK
  }
  track_vectors {
    text path PK
    text model PK
    int dim
    blob vector
  }
  lane_overrides {
    text path PK
    text lane
    int updated_at
  }
  play_history {
    int id PK
    text item_id
    text item_type
    text played_at
  }
  session_scenes {
    int id PK
    text session
    text mood
    real intensity
    int started_at
  }
  session_decisions {
    int id PK
    int at
    text kind
    text action
    text reason
    text track
    real probability
    text mood
    text source
  }
  session_lights {
    text session PK
    text area
    text hint
    int pinned
  }
  session_preferences {
    int id PK
    int at
    text segment
    text track
    text scene
    text source
  }
```

`track_vectors.path` is the library key, not a file path: music uses its path
relative to the music folder (unchanged from the first index), effects use
`sfx:<id>`, because effects never enter `tracks` and both folders can hold the
same relative name.

`lane_overrides.path` is that same key. `source` in `session_preferences` is
`manual`, `auto` or `reject`; a skip is a rejection, not a preference.

## Lights

Home Assistant on the LAN, and nothing else (ADR-0004). One WebSocket does the
whole job: the registries answer which lights exist and which Area they sit in,
`state_changed` says when the DM takes the light back, `call_service` writes.
REST is not used — it cannot see Areas.

The panel is absent from the DOM until a token and address are stored. A session
chooses an Area; Doty touches only `light.*` entities there, skipping a group
when every one of its members is in the same Area.

```mermaid
flowchart TD
  SCENE[confirmed Session Scene] --> DIR[light director]
  HINT[Session Hint] --> DIR
  DIR --> DWELL{dwell 25 s?}
  DWELL -->|no| HOLD[hold]
  DWELL -->|yes| P[Area Preset: hue by mood, brightness by intensity]
  P --> HA[light.turn_on · 3 s transition]
  HA --> CTX[context id remembered]
  CTX -->|state_changed with another context| PAUSE[auto paused 15 min]
  PAUSE -->|DM resumes| DIR
  SESSION[stt:start] --> SNAP[snapshot the Area]
  SESSION_END[stt:stop] -->|Doty wrote last| SNAP
```

The director is injected with a port, so the pause, the dwell and the restore are
tested without a socket; `home-assistant.ts` is tested against a fake HA that
speaks only the frames the client is allowed to depend on.

## Degradation

Nothing here may stop playback or hide the suggestions.

| Missing | What still works | What the UI says |
|---|---|---|
| Decision model | recommendations are heuristic | ranker status, per-option probabilities absent |
| Embedding model | search by name/tag; recommendations by keywords | `ready: false`, search `mode: 'text'` |
| Index incomplete | text search over the pane's shelf | `text search — index 12/43` |
| Audio verdict | duration, genre and the name decide | badge falls back to that guess |
| VAD model | RMS gate in the STT worker | none; transcript still arrives |
| STT model | no transcript; DM can type a prompt | onboarding / model status |
| Home Assistant | every other feature; the lights pane is absent | Settings says `needs reconnect` |

## IPC surface

| Area | Channels |
|---|---|
| Transcript | `stt:start` · `stt:stop` · `stt:transcribe-chunk` · `stt:transcript` · `stt:interim` · `stt:status` |
| Sessions | `session:create` · `session:list` · `session:load` · `session:rename` · `session:delete` |
| Library | `music:list` · `music:get-all-metadata` · `library:search` · `library:set-lane` · `library:move-track` · `embedding:status` · `embedding:progress` |
| Ranking | `ranker:decide` · `ranker:status` · `session:sfx-rank` |
| Director | `session:evaluate` · `session:decision` · `session:preference` · `session:report` |
| Playback | player, queue and SFX channels in `electron/ipc.ts` |
| Discord capture | `discord:get-capture-state` · `discord:set-capture-mode` · `capture:state` |
| Discord chat | `discord:get-send-transcript` · `discord:set-send-transcript` |
| Lights | `lights:get-state` · `lights:configure` · `lights:clear` · `lights:discover` · `lights:set-area` · `lights:set-auto` · `lights:set-power` · `lights:set-brightness` · `lights:set-mood` · `lights:set-hint` · `lights:resume` · event `lights:state` |

`session:evaluate` is the only channel whose request shape encodes policy
decisions (`musicEnabled`, `confidenceThreshold`); the answer is a plan, not a
command, so the renderer stays the only thing that touches playback.
