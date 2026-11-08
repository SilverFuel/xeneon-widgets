# Auxora recovery status, November 6, 2026

Follow-up source repairs and current verification results: [November 7 review](REVIEW-REPAIR-20261107.md). The entries below record the earlier recovery pass.

## Completed

- Recovered WoW Forever and TMOG companion work into the primary checkout, retaining backups under artifacts/recovery-before-resume-20261106.
- Standard native build now uses one MSBuild worker and disables shared compilation. Restore and Release build passed with zero warnings and errors using SDK 8.0.424.
- scripts/check-local.ps1 selects the local pinned SDK and bounds VSTest connection startup to 20 seconds, restoring environment variables afterward.
- Installer shutdown handles a process exiting during shutdown and preserves the Windows error and remaining process IDs on failure. Three isolated scenarios pass under Windows PowerShell and PowerShell 7.
- Window-guard startup and shutdown now have deadlines. Its actual hidden-process self-test passed with 475 window samples.
- Rendered tests check the host executable exists, report startup stages, and fail immediately when the host log reports initialization failure.
- Published the current native app and built artifacts/Auxora-Recovery-Local-Test-20261106.exe. This is an unsigned local development installer from a dirty working tree, not a public release candidate.

Installer SHA-256: D2B3CDE2F91B7F41A9E40AEE6DF4B149130E7DC7049B2658CD4F1E34A4BF1BD4

## Confirmed blockers

- VSTest's collector log records SocketException 10013 when connecting to its loopback server. A subsequent test run aborted after its explicit 15-second connection deadline. This is not a passing native test suite.
- The rendered host starts native services but HttpListener fails with "The handle is invalid." The isolated window guard confirmed that the app remained hidden. No rendered UI pass is claimed.
- The installed executable still reports 0.3.0-beta.1+20260731.60fbb76e2f9d32dc1b4a7e3bef1e48ad9428fd60. Installation has not been performed by this session, whose writable directories exclude the normal install location.
- ChatGPT's reported Daybreak restoration error has no established connection to Auxora and remains outside this code repair.

## Next verification

Run the checks in a normal Windows development session with the required SDK and working local socket access. Install the local test package after closing Auxora; preserve user data. Verify journal persistence, Forever auto-opening, TMOG readings and explicit launch, display placement, touch, restart, and upgrade behavior. Public release still requires the repository's exact-candidate qualification and release workflow.

Do not substitute this dirty local installer for a qualified release or report the unexecuted tests as passed.
