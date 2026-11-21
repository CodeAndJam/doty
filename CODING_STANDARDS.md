# Coding standards

Judgement calls a reviewer enforces. Mechanical rules belong in `biome.json` or
`scripts/`, not here.

## A cache names what invalidates it

A cache is correct only while nothing it read has changed. When you memoise,
write down the inputs and the events that end the value's life, in one line:

```ts
// Rebuilt on demand; dropped whenever the library, a label or a folder changes.
let cached: LibraryItem[] | null = null
```

Then make every one of those events call `invalidate()`. A cache invalidated by
"the scan" while the scanner writes per file is wrong for the whole scan: the
lane rule read a duration of 0 and called an 18-second sting a cue.

Review question: *what changes the value, and does each of those paths drop it?*

## A path value names its space

Two spaces are in play, and a string cannot tell you which:

- **relative** to the music folder (`Tavern/tavern.mp3`) — what the browser
  lists, what `track_vectors` stores for music;
- **absolute** (`/Users/…/sfx/Door/slam.wav`) — effects, sessions, anything the
  decoder opens.

Anything that stores, keys, caches, maps or forwards a path must say which one,
in the name (`playablePath`, `absolute`, `relativePath`) or in a comment on the
field. Three defects came from skipping this: a lane map keyed by one space and
read by the other, a search hit that played a 404, and `join(musicFolder, '/abs')`
in the Discord stream.

Review question: *for every path crossing a boundary, which space is it in, and
does the receiving side agree?*

## A label is data, not a location

The lane of a file is a resolved label (`override > classifier > folder`);
folders are sources. Code that infers a lane from a folder re-derives a decision
that already has an owner, and drifts from it. Read the label.

Review question: *is this a new derivation of something the library already
resolved?*

## A claim about behaviour survives review

Some comments assert a guarantee: "one writer", "one pass at a time", "the
socket is closed with the scope". Treat each as a question for review: *where is
that held?* The answer is a test, a type, or a line the reviewer can point at.
When the answer is nowhere, the comment is a wish — either write the check or
soften the sentence to describe what the code does.

Judgement, not a gate: no linter can read intent. It earns its place because
three review rounds went to comments that were true when written and false
after the next edit, and each sent a reader to the wrong conclusion.
