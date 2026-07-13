# Auxora transition and platform notes

Auxora is the working public name for the adaptive successor to XENEON Edge Host. The name still requires trademark and domain clearance; ShiftPanel and OrbitDeck remain fallback names.

## What this build establishes

- A four-destination shell: Home, Scenes, Library, and Settings.
- Compact landscape, standard landscape, ultrawide, and portrait layout classes.
- Work, Gaming, Media, Night, and Home Scene profiles with manual overrides and automatic rules.
- Scene precedence: temporary manual override, game, foreground application, media, schedule, then default.
- Generic saved-display selection and per-display Scene assignments.
- Local Smart Glance alerts, action chains, DDC/CI controls, a token-protected phone remote, and signed-extension inspection.
- Atomic migration of existing configuration and Windows-protected secrets into Auxora storage while retaining the legacy installation for rollback.

## Compatibility decisions

The internal executable, namespace, and some source-tree filenames remain `XenonEdgeHost` for this transition build. Public UI, installer identity, shortcuts, storage, and release assets use Auxora. Keeping the internal executable stable avoids breaking existing launchers and protected-secret entropy during migration.

Existing profiles, themes, layout order, preferred display, and Game Mode settings seed the new Scene configuration. Backups intentionally exclude credentials, integration endpoints, launcher paths, display identifiers, and logs.

## Trust and release gates

- The trusted extension publisher store is empty by default. Third-party code is not trusted until a publisher key is deliberately added.
- The phone remote starts only on request, uses a random expiring token, stays on the local network, and may require a Windows Firewall or URL ACL rule.
- DDC/CI controls appear only when the selected monitor reports a supported capability.
- Per-display Scene assignment and handoff are implemented. Simultaneous independent Auxora windows on multiple panels remain later work.
- Update availability checks exist, but signed installer verification, production code signing, automatic rollback, and clean-VM release certification remain required before a stable paid release.
- The macOS host remains a beta scaffold and is not part of this Windows-first milestone.

## Release verification

Before promoting this build, run `npm run check` and `npm run audit:deps`, then complete the clean-install, upgrade, rollback, and uninstall checklist on a fresh Windows profile or VM. Test touch behavior at the supported layout sizes and Windows scaling levels, including unsupported DDC/CI hardware and disconnected integrations.
