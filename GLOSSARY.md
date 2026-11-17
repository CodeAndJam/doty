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
DM's switch, then the classifier (duration, audio verdict, name), then the folder the file came
from. Folders are only sources, and one folder may hold both lanes.
_Avoid_: kind, type, category (the effects folder's own subfolder), library

**Override** — retired as a mode:
The table taking playback by hand no longer silences the ranker: suggestions keep arriving and
autopilot changes only at a boundary. Only the metric survives — `overrideRate` is the share of
acted-on decisions the DM replaced.
_Avoid_: manual mode, autopilot off, resume auto
