#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/notarize-macos.sh path/to/XENEON-Edge-Host.dmg" >&2
  exit 1
fi

artifact="$1"

if [[ ! -f "$artifact" ]]; then
  echo "Artifact not found: $artifact" >&2
  exit 1
fi

: "${APPLE_ID:?Set APPLE_ID to your Apple developer email.}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your Apple team ID.}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Set APPLE_APP_SPECIFIC_PASSWORD to an app-specific password.}"

echo "Submitting $artifact to Apple notarization..."
xcrun notarytool submit "$artifact" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --wait

echo "Stapling notarization ticket..."
xcrun stapler staple "$artifact"

echo "Notarization complete: $artifact"
