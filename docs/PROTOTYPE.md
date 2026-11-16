# Prototype: run it, then tell me what it got wrong

The point of this phase is not a clean demo. It is to find the **overrides**: the
moments you reach for the music yourself. Every one of those is a bug with a
reason attached, and the app now records it.

## Run

```bash
pnpm dev
```

The ranker and embedder are already in `~/.doty/models`, so no release is needed
on this machine. The 1.2 MB VAD model downloads once in the background if it is
missing. A fresh machine would need `models-v1`
published first; that is a distribution task, not a prototype task.

## Before the session (2 minutes)

1. **Music folder** — set it in Settings. The library is analysed on first launch;
   the energy fix re-analyses once, then caches.
2. **Check the badge** next to "Music": it says `model` when the decision model is
   loaded, `heuristic` when it is not. If it says `heuristic`, the session is still
   usable but the ranking is keyword-only — tell me.
3. **Loop mode** — leave it on the default single-track loop. That is what makes a
   "hold" at a boundary safe: the current cue continues instead of falling silent.
4. **Autopilot** — on. It changes the cue at a boundary only when the pick is
   clearly ahead (40% with a 1.5x margin) or the scene changed categorically (30%).
   It cuts a track short only at 90% with a 2x margin.
5. **SFX folder**, if you have one separate from the music folder.

## What to do during the session

Use it like you normally would. Do not help it: no pinning things you would
normally let it choose, no skipping early to "test" it. The useful signal is what
you do when you are not thinking about the tool.

At the end, or the moment something goes wrong, open the **decision log** and
press **copy**. It produces tab-separated rows:

```
time  ranker  action  track  confidence  reason  transcript
```

## What to send back

1. The copied decision log.
2. The session chip numbers: auto actions, manual picks, override rate.
3. The three moments that annoyed you most, each with: what was playing, what
   happened at the table, and what you would have played. This is worth more than
   any aggregate.
4. Whether the mic heard the music (one laptop mic + speakers). If it did, note
   roughly how much of the transcript is lyric or noise.

## How I read it

- **Override rate** is the headline. It is manual picks ÷ decisions. Under 0.3 is
  the target; above that, the suggestions are not earning their place.
- **Holds with a reason** tell me whether the gate is too conservative. If it
  repeats a cue through a scene change, the mood read missed the change.
- **Repeats you did not want** mean the boundary gate is too high.
- **Auto changes you skipped** are the expensive failure: a confident wrong cue.
  They are recorded as rejections and demote that track for that scene next time.

## Known limits, so you do not report them as surprises

- The mood model currently reads most dramatic narration as `epic`. That makes
  categorical transitions rarer than they should be.
- Recall is ~85%: one in seven times your pick is not among the twenty the model
  sees. Semantic retrieval is indexed but not yet merged into that twenty.
- SFX vs music is decided by duration and genre, with the audio-embedding verdict
  filling only the 20–45 s band where duration cannot. A long campfire or rain
  loop sounds like an effect to the model, so it is never demoted on that alone.
- Speech recognition now gates live audio with Silero VAD when the model file is
  present: a loud music bed, noise and silence produce no decoding at all. What
  still needs a real recording is vocal music crossing the gate and overlapping
  speakers. If the mic is picking up the speakers loudly, tell me — that is the
  case the synthetic bed does not cover.
- Everything is local. No telemetry, no upload; the decision log leaves the
  machine only if you paste it.
