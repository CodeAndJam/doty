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

**Override**:
A mode in which the table has taken control of playback by hand, so the ranker stops offering
recommendations until it is explicitly resumed.
_Avoid_: manual mode, mute, pause
