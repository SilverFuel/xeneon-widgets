# Auxora paid-preview pilot

Do not start this pilot with an unsigned build or before the commercial policies and monitored support paths are live.

## Cohort

- Recruit 10 to 25 people who use at least three different display classes.
- Include Windows 11 systems at 100%, 125%, 150%, 175%, and 200% scaling.
- Include at least two portrait touch displays, two compact displays, two ultrawide panels, one unsupported DDC/CI monitor, and one multi-monitor system.
- Keep the pilot invitation-only and version every installer given to a participant.

## Onboarding evidence

For every participant, record only non-secret operational facts:

- app and installer version;
- Windows version and display class;
- install, first launch, restart, upgrade, repair, and uninstall outcome;
- whether touch-only navigation was successful;
- integrations enabled, without credentials or private endpoint values;
- participant ID, support ticket ID, role-based support inbox, resolution time, refund request, and final outcome.

Do not ask participants to send API keys, tokens, calendar feed URLs, passwords, or unredacted support bundles.

Participant IDs and support ticket IDs are pseudonymous operational records, not public identifiers. Limit access to the people actively handling the pilot and support queue. Keep the ID-to-person mapping only in the approved support system, never in this repository or product telemetry. Delete or irreversibly pseudonymize the mapping and ticket exports within 30 days after the pilot closes, except records that must be retained for an active refund, dispute, security investigation, or legal obligation. Review those exceptions every 30 days and delete them as soon as the reason ends.

## Exit criteria

- At least 10 participants complete seven days of normal use.
- At least 90% complete installation and first launch without live assistance.
- No unresolved data-loss, secret-exposure, unsafe uninstall, or update-integrity issue exists.
- No unresolved issue blocks Home, Modes, Apps & Controls, Settings, Safe Mode, Repair, or uninstall.
- Every support request receives an initial response within the published support target.
- Refund and cancellation handling matches the published checkout policy.
- All pilot builds and their SHA256 values remain traceable to a Git commit.

If any security, data-loss, unsafe cleanup, or signed-update failure appears, stop distribution until it is fixed and independently retested.
