#!/usr/bin/env bash
# Validate the packaged DMG before it is uploaded to a release.
# Catches unsigned bundles ("Doty is damaged"), broken seals, wrong arch
# and missing app bundles.
set -euo pipefail

dmg="${1:-}"
if [ -z "$dmg" ]; then
  dmg=$(ls dist/*.dmg 2>/dev/null | head -n 1 || true)
fi
if [ -z "$dmg" ] || [ ! -f "$dmg" ]; then
  echo "No DMG found to verify" >&2
  exit 1
fi

echo "Verifying $dmg"
hdiutil verify "$dmg"

mount_dir=$(mktemp -d)
cleanup() {
  hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  rmdir "$mount_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" "$dmg" >/dev/null
app=$(find "$mount_dir" -maxdepth 1 -name '*.app' -print -quit)
if [ -z "$app" ]; then
  echo "DMG does not contain an .app bundle" >&2
  exit 1
fi

# This is the check that would have caught the 3.2.1 "damaged" build:
# an unsigned arm64 bundle is rejected by macOS at launch.
codesign --verify --deep --strict --verbose=2 "$app"
if ! codesign -dv "$app" 2>&1 | grep -q '^Signature='; then
  echo "App bundle is not code signed" >&2
  exit 1
fi

if ! file "$app/Contents/MacOS/"* | grep -q 'arm64'; then
  echo "App binary is not arm64" >&2
  exit 1
fi

# With a Developer ID certificate the bundle must also satisfy Gatekeeper,
# i.e. it must be signed and notarized, not just ad-hoc signed.
if [ "${HAS_CERT:-false}" = "true" ]; then
  spctl --assess --type execute --verbose=2 "$app"
fi

echo "DMG verified: $dmg"
