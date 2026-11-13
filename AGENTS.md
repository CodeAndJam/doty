# AGENTS.md — Doty Development Guide

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
Every commit message **must** follow this format:

```
<type>(<scope>): <short description>

[optional body]

[optional footer: BREAKING CHANGE: ...]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature (triggers minor version bump) |
| `fix` | Bug fix (triggers patch version bump) |
| `perf` | Performance improvement (triggers patch) |
| `refactor` | Code change that is neither a fix nor a feature |
| `chore` | Build process, tooling, dependency updates |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |
| `ci` | CI/CD pipeline changes |
| `style` | Formatting, whitespace (no logic change) |

A `BREAKING CHANGE:` footer or `!` after the type (e.g. `feat!:`) triggers a **major** version bump.

### Examples

```
feat(soundboard): add keyboard shortcuts for playback
fix(asr): handle empty transcript from sherpa-onnx
chore(deps): bump sherpa-onnx-node to 1.13.0
feat!: replace sidecar with native sherpa-onnx-node

BREAKING CHANGE: Python sidecar is no longer required
```

## Branching

- `main` — production-ready code. Every merge triggers a release.
- Feature branches: `feat/<short-name>`
- Bug fix branches: `fix/<short-name>`
- Chore branches: `chore/<short-name>`

## Pull Requests

- PR titles must also follow Conventional Commits format (used as the squash commit message).
- Keep PRs focused — one logical change per PR.
- All checks must pass before merging.

## Release Process

Releases are **fully automated**. On every push/merge to `main`:

1. [`release-please`](https://github.com/googleapis/release-please) reads commit history and bumps the version in `package.json` following semver.
2. It opens (or updates) a Release PR with a generated `CHANGELOG.md`.
3. When the Release PR is merged, `release-please` creates a GitHub Release and tag.
4. The `build-dmg` workflow triggers on the new tag, builds the macOS DMG via `electron-builder`, and uploads it as a release asset.

**You never manually edit `CHANGELOG.md` or bump versions in `package.json`.**

## Task Tracking

Maintain a `TODO.md` file at the project root to track pending work, known issues, and planned features. Update it as tasks are completed or new ones are identified. This file serves as a lightweight project board for contributors and AI agents.

## Product Intent

**A DM should never have to touch Doty mid-session.** Music and SFX follow the
table on their own: the right mood, the right transition moment, no whiplash,
no vocals over narration, no silence between tracks. Every recommendation and
autopilot change is judged against that, not against "did the model run".

Concretely, when changing anything in the recommendation or playback path:

- **The DM's attention is the scarce resource.** A suggestion the DM has to act
  on, a track they have to skip, or a switch they have to time by hand is a
  defect, even when the model was correct.
- **Never embarrassing beats clever.** A confident wrong SFX, a vocal track over
  a monologue, or a mid-scene hard cut costs more than a missed opportunity.
  When unsure, keep playing.
- **Prefer changing at boundaries.** The next track is chosen before the current
  one ends. Mid-track changes are the exception, for categorical scene changes
  only, and need a higher bar than a boundary change.
- **Degrade, never block.** Missing model, missing metadata or an unfamiliar
  language must fall back to keyword/energy matching with the mode visible in
  the UI. Nothing in this path may stop playback or hide suggestions.
- **Measure the goal.** Overrides per session and time-to-first-manual-pick are
  the KPIs. Thresholds and heuristics change only against real session data (see
  `test-fixtures/` and the eval items in `TODO.md`), never on intuition.
- **Everything local.** No telemetry, no cloud calls; model downloads are the
  only network use.

## Local Development

Dependencies are held for **10 days** after publish before adoption
(`minimumReleaseAge` in `pnpm-workspace.yaml`). Bump a version only when it is
older than that; security fixes can be exempted with `minimumReleaseAgeExclude`.

`pnpm dev` in a git worktree uses its own profile (`~/.doty/profiles/<name>`),
so several checkouts can run at once; `DOTY_PROFILE=<name>` overrides it and
downloaded models stay shared in `~/.doty/models`.

```bash
# Install deps and rebuild native addons
npm install

# Run in dev mode
npm run dev

# Build production bundles
npm run build

# Package DMG locally (requires macOS)
npm run dist
```

## Native Addons

`sherpa-onnx-node` is a native C++ addon and must be rebuilt against Electron's Node.js version after `npm install`. This is handled automatically via the `postinstall` script using `electron-rebuild`.

If you see a `NODE_MODULE_VERSION` mismatch error, run:

```bash
npm run rebuild
```

## Model Files

- Default STT: Nemotron 3.5 streaming GGUF (~716 MB), focused on `pt-PT`; other GGUF models are selectable in Settings. Downloaded to `~/.doty/models/`.
- Recommendation reranker: multilingual `mmarco-mMiniLMv2-L12` cross-encoder (~80 MB), downloaded on first use to `~/.doty/hf-cache/`. Runs in a worker thread, never on the Electron main thread.

These are never committed to the repository.
