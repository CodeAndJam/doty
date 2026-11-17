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
  AUD --> KIND[classify vs two anchors<br/>margin 0.03]
  KIND --> VEC

  Q[search text] --> EMBED[embedQuery]
  EMBED --> FULL{all items on this lane<br/>have a vector?}
  FULL -->|yes| TOPK[topK cosine]
  TOPK --> PIN[pin exact name/tag matches first]
  FULL -->|no| LOWER[lowercase · all tokens must appear]
  PIN --> RES[items + mode: semantic]
  LOWER --> RES2[items + mode: text]

  VEC --> TOPK
  KIND -->|20–45 s band| LANES
  DESC -->|name, tags| LOWER
```

Indexing is one run with two reported phases (`text`, then `audio`), and it
**pauses while the microphone is recording**: the transcript is the critical
path, and the index is minutes of model work. It resumes when recording stops.

Lane resolution, in isolation:

```mermaid
flowchart LR
  O{DM override?} -->|yes| OL[label it]
  O -->|no| G{genre says effects?}
  G -->|yes| CL[classifier wins]
  G -->|no| C{duration ≤ 20 s or ≥ 45 s?}
  C -->|yes| CL
  C -->|no| A{audio verdict<br/>confident?}
  A -->|yes| CL
  A -->|no| N{name says sfx/music?}
  N -->|yes| CL
  N -->|no| F[folder it came from]
```

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

## Degradation

Nothing here may stop playback or hide the suggestions.

| Missing | What still works | What the UI says |
|---|---|---|
| Decision model | recommendations are heuristic | ranker status, per-option probabilities absent |
| Embedding model | search by name/tag; recommendations by keywords | `ready: false`, search `mode: 'text'` |
| Index incomplete | text search on that lane | `text search — index 12/43` |
| Audio verdict | duration decides | badge falls back to the lane label |
| VAD model | RMS gate in the STT worker | none; transcript still arrives |
| STT model | no transcript; DM can type a prompt | onboarding / model status |

## IPC surface

| Area | Channels |
|---|---|
| Transcript | `stt:start` · `stt:stop` · `stt:transcribe-chunk` · `stt:transcript` · `stt:interim` · `stt:status` |
| Sessions | `session:create` · `session:list` · `session:load` · `session:rename` · `session:delete` |
| Library | `music:list` · `music:get-all-metadata` · `library:search` · `library:set-lane` · `library:move-track` · `embedding:status` · `embedding:progress` |
| Ranking | `ranker:decide` · `ranker:status` · `session:sfx-rank` |
| Director | `session:evaluate` · `session:decision` · `session:preference` · `session:report` |
| Playback | player, queue and SFX channels in `electron/ipc.ts` |

`session:evaluate` is the only channel whose request shape encodes policy
decisions (`musicEnabled`, `confidenceThreshold`); the answer is a plan, not a
command, so the renderer stays the only thing that touches playback.
