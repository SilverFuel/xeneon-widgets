# Camera Detection / Frigate Certification

Run this gate against the exact Windows beta candidate before advertising Camera Detection as release-qualified. Fixtures, mocked servers, and source tests do not satisfy this gate.

## Required environment

- Exact candidate installer and `release-manifest.json` from the release asset directory.
- Installed Auxora candidate reporting the manifest version and its dashboard asset revision through `/api/health`.
- Physical Frigate server on the intended local/private target LAN.
- Real camera with a testable detection zone.
- Authenticated HTTPS Frigate endpoint with a certificate trusted by Windows.
- Frigate viewer or purpose-built custom role restricted to the selected camera.

Never put a username, password, bearer token, cookie, authorization header, or other secret in the receipt.

## Qualification sequence

1. Install the exact candidate and record its filename and SHA-256 from the release manifest.
2. In Auxora Diagnostics, save the HTTPS Frigate endpoint, selected camera, and restricted credentials. Confirm **Camera connected** and health state **Ready**.
3. Trigger a real event in the selected camera/zone. Confirm Camera Detection renders the correct camera, label, zone, timestamp, and a non-empty JPEG/PNG/WebP snapshot.
4. Confirm events from a different camera do not appear while the camera filter is active, and confirm a snapshot URL copied from that other camera cannot be fetched through Auxora's localhost snapshot endpoint.
5. Exercise a viewer or custom role without administrator permissions and confirm events and snapshots still work only for the allowed camera.
6. Expire or revoke the current Frigate session. Confirm Auxora performs one successful reauthentication and resumes without sending unauthenticated event/snapshot requests.
7. Disconnect Frigate or the target LAN. Confirm Auxora reports a retryable disconnected/needs-attention state without clearing saved settings or showing stale data as live.
8. Restore connectivity. Confirm save-and-test or normal refresh returns health to **Ready** and new events/snapshots render again.
9. Complete the schema-1 receipt below using observations from this run, then verify it against the exact release asset directory.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Test-FrigateQualificationReceipt.ps1 `
  -ReceiptPath .\frigate-qualification-receipt.json `
  -ReleaseAssetsPath .\release-assets
```

## Receipt template

```json
{
  "schemaVersion": 1,
  "tag": "v0.3.0-beta.1",
  "version": "0.3.0-beta.1",
  "commitSha": "<40-character manifest commit>",
  "installerFileName": "Auxora-Setup-0.3.0-beta.1-<timestamp>.exe",
  "installerSha256": "<64-character manifest hash>",
  "app": {
    "name": "Auxora",
    "version": "0.3.0-beta.1",
    "assetRevision": "20260721-46"
  },
  "environment": {
    "physicalFrigateServer": true,
    "realCamera": true,
    "targetLan": true,
    "windowsTrustedTls": true,
    "frigateVersion": "<version>",
    "endpoint": "https://frigate.example.lan:8971/",
    "camera": "driveway",
    "role": "viewer"
  },
  "authentication": {
    "configured": true,
    "authenticated": true,
    "tokenRenewalObserved": true
  },
  "evidence": {
    "eventObservedAt": "<ISO-8601 timestamp within 15 minutes of completion>",
    "snapshotContentType": "image/jpeg",
    "snapshotBytes": 12345
  },
  "checks": {
    "saveAndTest": true,
    "authenticatedLogin": true,
    "viewerOrCustomRole": true,
    "cameraFilter": true,
    "freshEvent": true,
    "snapshot": true,
    "tokenRenewal": true,
    "disconnectDetected": true,
    "reconnectRecovered": true
  },
  "operator": "<operator name>",
  "completedAt": "<ISO-8601 timestamp>"
}
```

The verifier fails closed if the receipt is not bound to the exact manifest, uses a fixture instead of physical hardware, uses plaintext authentication, contains secret fields, records stale event evidence, or leaves any required check false.
