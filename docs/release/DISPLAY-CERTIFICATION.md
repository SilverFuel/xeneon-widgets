# Auxora display certification matrix

Automated responsive checks protect layout classification and navigation structure, but they do not qualify physical placement or touch behavior. Before any public release, install the exact manifest-bound candidate on a physical Windows machine with its intended companion display and complete this gate. Virtual displays, browser emulation, and source tests do not satisfy it.

| Resolution | Orientation | Expected class | Scaling | Automated | Touch and visual |
| --- | --- | --- | --- | --- | --- |
| 800 x 480 | Landscape | Compact | 100%, 125%, 150%, 175%, 200% | Required | Pending external hardware |
| 1024 x 600 | Landscape | Standard at 100%; compact at 125-200% | 100%, 125%, 150%, 175%, 200% | Required | Pending external hardware |
| 1280 x 400 | Ultrawide | Ultrawide | 100%, 125%, 150%, 175%, 200% | Required | Pending external hardware |
| 1280 x 800 | Landscape | Standard at 100-125%; compact at 150-200% | 100%, 125%, 150%, 175%, 200% | Required | Pending external hardware |
| 1920 x 480 | Ultrawide | Ultrawide | 100%, 125%, 150%, 175%, 200% | Required | Pending external hardware |
| 1920 x 1080 | Landscape | Standard | 100%, 125%, 150%, 175%, 200% | Required | Pending external hardware |
| 2560 x 720 | Ultrawide | Ultrawide | 100%, 125%, 150%, 175%, 200% | Required | Pending external hardware |
| 800 x 1280 | Portrait | Portrait | 100%, 125%, 150%, 175%, 200% | Required | Pending external hardware |

For each available physical resolution, verify Home, Modes, Apps & Controls, Settings, long-press edit mode, quick controls, scrolling, Mode switching, dialogs, keyboard focus, screen-reader names, and reduced motion. On the target companion display, exercise Windows scaling at 100%, 125%, 150%, 175%, and 200%.

Also verify all of these exact-candidate behaviors:

- Auxora starts only on the active non-primary companion display and never intersects the primary display.
- With no companion active, Auxora stays tray-only; it does not fall back to the primary display.
- Physical unplug/replug recovers onto the companion display.
- Making the companion display primary causes Auxora to fail closed; restoring roles recovers safely.
- Windows display reorder preserves the saved physical-display preference.
- The window is borderless, absent from Alt+Tab/taskbar, covers the companion bounds, and leaves no taskbar visible underneath it.
- Physical tap, long-press, and scrolling work; dialogs remain contained and readable at every required scale.
- Refreshes do not cause visible periodic flicker, duplicated layers, stale overlays, or focus loss.

Record only privacy-safe screenshot identifiers. Do not put local paths, URLs, serial numbers, EDID/device-instance data, credentials, or other private device data in the receipt.

The schema-1 receipt is intentionally strict and fails closed:

- `schemaVersion` is the JSON integer `1`, not `"1"`, `1.0`, or `true`.
- The receipt root plus `app`, `environment`, `checks`, and `evidence` must exactly match the property shapes shown in the template, with no missing, extra, or differently-cased fields. Required text values are non-empty JSON strings.
- `physicalWindowsMachine`, `physicalCompanionDisplay`, `multipleActiveDisplays`, `physicalTouch`, and every required check are the JSON Boolean `true`, not strings or numbers.
- `checks` contains exactly the check names enforced by the verifier, with no missing, extra, or differently-cased names.
- `companionWidth` and `companionHeight` are positive JSON integers. `testedScalingPercent` is a JSON array containing exactly the integer values `100`, `125`, `150`, `175`, and `200`, once each, in any order.
- `screenshotReferences` is a non-empty JSON array of privacy-safe identifier strings.
- `completedAt` is an ISO-8601 UTC string ending in `Z` or `+00:00`. It must be no more than five minutes in the future and no older than 30 days when verified.

## Copyable schema-1 receipt template

Copy this JSON into `display-qualification-receipt.json`, then replace every `REPLACE_...` value and both `0` dimensions with observations from the physical certification session. Copy the exact `tag`, `version`, `commitSha`, `installerFileName`, and `installerSha256` values from `release-assets/release-manifest.json`; `app.version` must repeat that same manifest version. Record the installed dashboard revision in `app.assetRevision` using its `YYYYMMDD-NN` value. The placeholder timestamp and zero dimensions deliberately fail closed until replaced. Set every check to `true` only after that exact behavior has passed on the manifest-bound candidate.

```json
{
  "schemaVersion": 1,
  "tag": "REPLACE_FROM_RELEASE_MANIFEST",
  "version": "REPLACE_FROM_RELEASE_MANIFEST",
  "commitSha": "REPLACE_FROM_RELEASE_MANIFEST",
  "installerFileName": "REPLACE_FROM_RELEASE_MANIFEST",
  "installerSha256": "REPLACE_FROM_RELEASE_MANIFEST",
  "app": {
    "name": "Auxora",
    "version": "REPLACE_FROM_RELEASE_MANIFEST",
    "assetRevision": "REPLACE_WITH_INSTALLED_ASSET_REVISION"
  },
  "environment": {
    "physicalWindowsMachine": true,
    "physicalCompanionDisplay": true,
    "multipleActiveDisplays": true,
    "physicalTouch": true,
    "windowsVersion": "REPLACE_WITH_WINDOWS_VERSION",
    "companionModel": "REPLACE_WITH_PUBLIC_MODEL_NAME",
    "companionWidth": 0,
    "companionHeight": 0,
    "testedScalingPercent": [100, 125, 150, 175, 200]
  },
  "checks": {
    "startupCompanionOnly": true,
    "noPrimaryIntersection": true,
    "trayOnlyWithoutCompanion": true,
    "hotPlugRecovery": true,
    "primaryRoleSwitchFailClosed": true,
    "savedPreferenceAfterReorder": true,
    "borderless": true,
    "taskbarHidden": true,
    "touchTap": true,
    "touchLongPress": true,
    "touchScroll": true,
    "keyboardFocus": true,
    "screenReaderNames": true,
    "readableAtAllScales": true,
    "dialogsContained": true,
    "reducedMotion": true,
    "noRefreshFlicker": true
  },
  "evidence": {
    "screenshotReferences": [
      "REPLACE_WITH_PRIVACY_SAFE_EVIDENCE_ID"
    ]
  },
  "operator": "REPLACE_WITH_APPROVED_OPERATOR_ID",
  "completedAt": "REPLACE_WITH_CURRENT_UTC_TIMESTAMP"
}
```

The schema has no separate `altTabHidden` or `fullBounds` property, and extra fields are rejected. Record those observations through the existing checks and evidence identifiers:

| Physical observation | Checks that certify it | Privacy-safe evidence identifier examples |
| --- | --- | --- |
| Auxora is absent from Alt+Tab and the taskbar | `borderless` and `taskbarHidden` | `alt-tab-hidden-100pct`, `taskbar-hidden-100pct` |
| Auxora covers the full companion bounds, stays on that display, and leaves no taskbar underneath | `startupCompanionOnly`, `noPrimaryIntersection`, `borderless`, and `taskbarHidden` | `companion-full-bounds-100pct`, `companion-full-bounds-200pct` |

An evidence identifier names the retained certification capture; it is not a path or URL. Keep the actual capture with the release evidence, and do not add notes, paths, or new properties to the receipt.

Verify the completed schema-1 receipt against the exact release asset directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Test-DisplayQualificationReceipt.ps1 `
  -ReceiptPath .\display-qualification-receipt.json `
  -ReleaseAssetsPath .\release-assets
```

Use the field/check names enforced by `scripts/Test-DisplayQualificationReceipt.ps1`. The fixture suite in `scripts/test-display-qualification-receipt.ps1` is an example structure only and is never physical evidence.
