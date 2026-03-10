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

## Local Development

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

- Parakeet TDT v3 ONNX (~640 MB) — downloaded on first launch to `~/.doty/models/`
- Qwen3-0.6B ONNX (~400 MB q4) — downloaded on first recommendation to `~/.doty/hf-cache/`

These are never committed to the repository.
