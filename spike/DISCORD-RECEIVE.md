# Prototype: Discord receive, one recogniser per speaker

Throwaway. Delete this file and `discord-receive.mjs` once the answer is in
(commit them to a `spike/discord-receive` branch and keep the numbers here).

> The app now carries this flow itself: Settings → Director → Discord panel →
> **Capture → Transcribe other participants** (`electron/discord-capture.ts`).
> This script stays only for the cost numbers, which the UI does not print.

## The question

Per-speaker capture is settled. What is not settled is whether one worker per
speaker is affordable: `transcribe-cpp` allows **one compute in flight per
model** (`node_modules/transcribe-cpp/README.md:241-250`), so N speakers means N
model loads and N streams contending for the same Metal device. If that holds up
here, per-speaker streaming is the build. If it serialises, the fallback is one
model with per-speaker buffers decoded in batch.

## Run it

Quit Doty first — same bot token, same voice channel, and the gateways fight.

```bash
pnpm spike:discord
```

It walks the setup itself: **1/3** bot token (typed, not echoed, never stored),
**2/3** the server, **3/3** the voice channel, **4/4** listening. The token prompt
is skipped when `DOTY_DISCORD_TOKEN` is set; the server and channel prompts are
skipped when the app's remembered ones still resolve, or when you pass
`--guild <id> --channel <id>`. Nothing is written back to the settings file —
after the prompts it prints the rerun line.

The token is needed at all because Doty stores yours encrypted via `safeStorage`
(Discord Developer Portal → your app → Bot → Reset Token). `--model <path>`
overrides the STT model it picks from `~/.doty/models`.

You need **someone else** in the channel — receive only ever delivers other
users. Your own phone or a second machine is enough.

## Reading the output

```
16:02:11 Ana: olá malta, vamos começar
16:02:19 novo: eu ataco o goblin
16:02:31 3 speaker(s), 42 feeds, 20s, rss 1.4 GB
```

Every committed revision of a speaker's hypothesis is one line, prefixed with the
clock and the Discord display name. Dim lines are spike status. `Ctrl-C` prints a
table: model load per speaker, utterances, audio seconds, decode time, and the
real-time factor (decode seconds ÷ audio seconds) — anything at or under ~0.3 is
comfortable headroom.

## What answers the question

- **Does receive work at all?** Any line other than status means yes.
- **Does it stay real-time with several speakers?** Watch for lines falling behind
  (text arriving long after it was said) and for RTF climbing toward 1.0 per
  speaker in the summary.
- **Do the labels hold?** One prefix per person, no swap between speakers. A
  swap would mean attribution is wrong, and per-speaker decode is pointless.
- **Does our own music come back?** Mute Doty's music on one speaker's side and
  listen for lyrics in the text after a quiet passage — that is the Q11 risk.

## What it does not do

No UI, no VTT, no session WAV, no capture-mode toggle, no mic capture, no ranker
input, no app integration. It is a pipe with a print at the end.
