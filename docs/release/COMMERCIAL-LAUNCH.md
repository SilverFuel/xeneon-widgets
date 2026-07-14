# Auxora commercial launch gate

Auxora must remain a free beta until every blocking item below has verifiable evidence. Repository checks can protect the release process, but they cannot substitute for legal review, monitored customer support, a trusted signing identity, or physical-device testing.

## Blocking evidence

- [ ] The Auxora name has documented trademark and domain clearance for the intended sales regions.
- [ ] A reviewed commercial license, terms of sale, privacy notice, and refund policy are published in the checkout flow and packaged with the app.
- [ ] Real monitored support and security inboxes are published in `support.html`, receipts, and release notes.
- [ ] The Windows app executable and installer have valid timestamped Authenticode signatures.
- [ ] The release installer version matches `app/XenonEdgeHost.csproj` and its SHA256 sidecar matches the uploaded file.
- [ ] Clean install, first launch, restart, upgrade, repair, rollback, normal uninstall, and remove-all-data tests pass on a disposable Windows profile or VM.
- [ ] Touch-only certification passes for the supported compact, standard, ultrawide, and portrait display matrix at Windows scaling from 100% through 200%.
- [ ] Unsupported DDC/CI displays and disconnected optional integrations fail softly without empty or broken controls.
- [ ] A previous signed installer remains downloadable as the rollback release.
- [ ] A paid-preview report covers at least 10 external users and has no unresolved launch-blocking issue.

## Required commands

Copy `docs/release/commercial-launch-evidence.example.json` to `commercial-launch-evidence.json` at the repository root, replace every placeholder with completed, non-sensitive evidence, and commit that release-specific file with the candidate. Add every currently approved Auxora code-signing certificate SHA-1 thumbprint to `releaseArtifact.allowedSignerThumbprints`; retaining both old and new identities during a planned rotation provides an explicit overlap window. The protected commercial workflow and local gate both require this exact root path. Set `confirmedAt` when the complete evidence set is rechecked; the gate rejects evidence confirmations older than 30 days.

Before running either command below, replace both `<version>` and `<timestamp>` in `-InstallerPath` with the exact values from the candidate installer filename.

```powershell
npm run check
npm run audit:deps
powershell -File scripts\run-release-gauntlet.ps1 `
  -InstallerPath app\dist\Auxora-Setup-<version>-<timestamp>.exe `
  -RequireSignedInstaller `
  -CommercialEvidencePath .\commercial-launch-evidence.json
```

Run the destructive installer checks only in a disposable environment:

```powershell
powershell -File scripts\run-release-gauntlet.ps1 `
  -InstallerPath app\dist\Auxora-Setup-<version>-<timestamp>.exe `
  -RequireSignedInstaller `
  -CommercialEvidencePath .\commercial-launch-evidence.json `
  -RunInstallSmoke `
  -RunUninstall `
  -RemoveLocalData
```

## Current external dependencies

The following items cannot be completed by source changes alone:

- purchasing or provisioning a code-signing identity;
- choosing and monitoring support and security mailboxes;
- obtaining legal review and name clearance;
- providing disposable Windows environments and representative physical touch displays;
- recruiting paid-preview participants and processing customer payments.
