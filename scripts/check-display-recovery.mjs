import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const mainWindow = readWorkspaceFile("app/MainWindow.xaml.cs");
const mainWindowXaml = readWorkspaceFile("app/MainWindow.xaml");
const appXaml = readWorkspaceFile("app/App.xaml.cs");
const trayIcon = readWorkspaceFile("app/TrayIcon.cs");
const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");
const displayManager = readWorkspaceFile("app/Services/DisplayManager.cs");
const configController = readWorkspaceFile("app/Controllers/ConfigController.cs");
const telemetryController = readWorkspaceFile("app/Controllers/TelemetryController.cs");
const supportController = readWorkspaceFile("app/Controllers/SupportController.cs");
const setupWidget = readWorkspaceFile("js/widgets/setup.js");
const systemWidget = readWorkspaceFile("js/widgets/system.js");
const nativeHostApiTest = readWorkspaceFile("scripts/test-native-host-api.mjs");
const installScript = readWorkspaceFile("app/install.ps1");
const displayReceipt = readWorkspaceFile("scripts/Test-DisplayQualificationReceipt.ps1");
const displayReceiptFixtures = readWorkspaceFile("scripts/test-display-qualification-receipt.ps1");
const displayCertification = readWorkspaceFile("docs/release/DISPLAY-CERTIFICATION.md");

function readWorkspaceFile(relativePath) {
  const filePath = resolve(process.cwd(), relativePath);
  try {
    if (!existsSync(filePath)) {
      throw new Error("file does not exist");
    }

    return readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Unable to read ${relativePath} at ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  /SystemEvents\.DisplaySettingsChanged\s*\+=\s*HandleDisplaySettingsChanged/.test(mainWindow)
    && /SystemEvents\.DisplaySettingsChanged\s*-=\s*HandleDisplaySettingsChanged/.test(mainWindow)
    && /ScheduleDisplayRecovery\("startup display backoff"\)/.test(mainWindow)
    && /ScheduleDisplayRecovery\("display topology changed"\)/.test(mainWindow)
    && /DisplayRecoveryDelays/.test(mainWindow)
    && /TryRecoverDisplayPlacementAsync/.test(mainWindow)
    && /ApplyDisplaySelectionWindow/.test(mainWindow)
    && /RestoreDisplayWindowToTaskbar/.test(mainWindow)
    && /_waitingForEdgeDisplay/.test(mainWindow)
    && /needsDisplaySelection/.test(mainWindow)
    && /DisplayPreferenceChanged/.test(mainWindow)
    && /ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow),
  "main window must recover display placement and use a windowed chooser until one of multiple companion displays is selected"
);

assert(
  /x:Name="DisplayPickerPanel"/.test(mainWindowXaml)
    && /Background="#FF070B10"/.test(mainWindowXaml)
    && /x:Name="DisplayPickerList"/.test(mainWindowXaml)
    && /Foreground="#FFF5F8FA"/.test(mainWindowXaml)
    && /ShowDisplayPicker/.test(mainWindow)
    && /HandleDisplayChoice/.test(mainWindow)
    && /SetDisplayPreference/.test(bridgeManager)
    && !/Open Settings and select the touch display/.test(mainWindow),
  "first-run display selection must be an opaque, high-contrast, directly actionable picker"
);

assert(
  /\$trigger\.Delay\s*=\s*"PT20S"/.test(installScript),
  "installed startup task must delay launch so display topology can settle after reboot"
);

assert(
  /HandleActivated[\s\S]+ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow)
    && /ShowDisplayWindow[\s\S]+ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow),
  "automatic launch and tray show must revalidate companion placement without saving display preference"
);

assert(
  /RetryNavigationAsync\(failureAttempt\)/.test(mainWindow)
    && /_dashboardLoaded \|\| _navigationFailures != failureAttempt/.test(mainWindow)
    && /Dashboard startup navigation was interrupted once/.test(mainWindow)
    && /DashboardView\.NavigationStarting \+= HandleNavigationStarting/.test(mainWindow)
    && /args\.NavigationId == _dashboardNavigationId/.test(mainWindow)
    && /IsDashboardSource\(sender\.Source\)/.test(mainWindow)
    && /Ignoring successful non-dashboard navigation completion/.test(mainWindow),
  "only the tracked dashboard navigation may cancel startup recovery; blank or intermediate completions must not be reported as a loaded dashboard"
);

assert(
  /_mainWindow\.Start\(\)/.test(appXaml)
    && !/_mainWindow\.Activate\(\)/.test(appXaml)
    && /internal void Start\(\)[\s\S]+var placementReady = ConfigureWindow\(saveSelection:\s*false\)[\s\S]+RevealConfiguredWindow\(\)/.test(mainWindow)
    && /EnterCompanionDisplayWaitingState[\s\S]+ShowWindow\(windowHandle, SwHide\)/.test(mainWindow),
  "startup must validate a companion target before the native window is first revealed"
);

assert(
  /HandleBridgeReady[\s\S]+_bridgeReady = true[\s\S]+BeginDashboardStartupIfReady/.test(mainWindow)
    && /BeginDashboardStartupIfReady[\s\S]+!_hasBeenActivated[\s\S]+_companionDisplayUnavailable[\s\S]+return/.test(mainWindow)
    && /RevealConfiguredWindow[\s\S]+ShowWindowNoActivate\(\);[\s\S]+BeginDashboardStartupIfReady\(\)/.test(mainWindow),
  "native services may start while Auxora is hidden, but WebView2 must wait for a verified companion window"
);

assert(
  /MoveAndResize\(new RectInt32\([\s\S]+SetPresenter\(AppWindowPresenterKind\.FullScreen\);[\s\S]+EnsureDisplayWindowStaysOffTaskbar\(windowHandle\)/.test(mainWindow)
    && /if \(!_waitingForEdgeDisplay\)[\s\S]+SetPresenter\(AppWindowPresenterKind\.FullScreen\);[\s\S]+EnsureDisplayWindowStaysOffTaskbar\(_windowHandle\)/.test(mainWindow)
    && /EnsureDisplayWindowStaysOffTaskbar[\s\S]+if \(windowHandle == IntPtr\.Zero\)[\s\S]+KeepDisplayWindowOnTop/.test(mainWindow)
    && !/windowHandle == IntPtr\.Zero \|\| _taskbarStyleApplied/.test(mainWindow),
  "dashboard placement must enter fullscreen first, then reassert taskbar-free topmost styles after every topology or mode change"
);

assert(
  !/\bpreferPrimary\b/.test(mainWindow)
    && !/\bpreferPrimary\b/.test(bridgeManager)
    && !/rescueDisplay\s*=\s*[^;]*IsPrimary/.test(mainWindow)
    && /\.Where\(display => !display\.IsPrimary\)/.test(mainWindow)
    && /if\s*\(targetDisplay\.IsPrimary\)[\s\S]+refused to show its window/.test(mainWindow),
  "normal, first-run, and Safe Mode placement must never request or accept the Windows primary display"
);

assert(
  /HandleDisplaySettingsChanged[\s\S]+ShowWindow\(windowHandle, SwHide\)[\s\S]+ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow)
    && /TryRecoverDisplayPlacementAsync[\s\S]+var recovered = ConfigureWindow\(saveSelection:\s*false\)[\s\S]+if\s*\(recovered\)[\s\S]+RevealConfiguredWindow\(\)/.test(mainWindow)
    && /ShowDisplayWindow\(\)[\s\S]+SwHide[\s\S]+ConfigureWindow\(saveSelection:\s*false\)[\s\S]+RevealConfiguredWindow\(\)/.test(mainWindow),
  "hot-plug recovery and tray show must hide first and reveal only after companion placement succeeds"
);

assert(
  /PersistentDisplayRecoveryDelay\s*=\s*TimeSpan\.FromSeconds\(15\)/.test(mainWindow)
    && /while \(!_disposed && !token\.IsCancellationRequested\)/.test(mainWindow)
    && /attempt < DisplayRecoveryDelays\.Length[\s\S]+PersistentDisplayRecoveryDelay/.test(mainWindow)
    && !/DateTimeOffset\.UtcNow - startedAt > DisplayRecoveryWindow/.test(mainWindow),
  "companion recovery must continue at a low frequency until a late or missed Windows display event becomes usable"
);

assert(
  /CommandMoveDisplay/.test(trayIcon)
    && /Move Auxora Display\.\.\./.test(trayIcon)
    && /onMoveDisplay:\s*\(\) => DispatcherQueue\.TryEnqueue\(BeginDisplayMoveMode\)/.test(mainWindow)
    && /BeginDisplayMoveMode[\s\S]+ListDisplayCandidates\(ignoreSavedPreference:\s*true\)[\s\S]+Where\(display => !display\.IsPrimary\)/.test(mainWindow)
    && /Position is unlocked[\s\S]+choose the companion below to lock Auxora there/.test(mainWindow)
    && /HandleAppWindowClosing[\s\S]+if \(_displayMoveMode\)[\s\S]+ConfigureWindow\(saveSelection:\s*false\)[\s\S]+RevealConfiguredWindow\(\)/.test(mainWindow),
  "Auxora must expose a deliberate move mode that returns to sticky companion placement when canceled"
);

assert(
  /ScheduleLockedPresentationReassert\(\)/.test(mainWindow)
    && /TimeSpan\.FromMilliseconds\(120\)/.test(mainWindow)
    && /TimeSpan\.FromMilliseconds\(850\)/.test(mainWindow)
    && /ReassertLockedPresentationAsync[\s\S]+KeepDisplayWindowOnTop\(_windowHandle\)/.test(mainWindow)
    && /generation != Volatile\.Read\(ref _lockedPresentationGeneration\)/.test(mainWindow)
    && /_displayMoveMode[\s\S]+_waitingForEdgeDisplay[\s\S]+_companionDisplayUnavailable/.test(mainWindow),
  "locked placement must reassert topmost z-order after Windows finishes raising the companion taskbar, while move and waiting modes cancel the reassertion"
);

assert(
  /AppWindow\.Changed \+= HandleAppWindowChanged/.test(mainWindow)
    && /AppWindow\.Changed -= HandleAppWindowChanged/.test(mainWindow)
    && /ConstrainDisplayPickerToCompanion[\s\S]+Where\(display => !display\.IsPrimary\)/.test(mainWindow)
    && /IntersectionArea[\s\S]+Math\.Clamp\(position\.X, target\.Bounds\.Left, target\.Bounds\.Right - width\)/.test(mainWindow)
    && /AppWindow\.MoveAndResize\(new RectInt32\(x, y, width, height\)\)/.test(mainWindow),
  "the unlocked picker must remain constrained to active non-primary companion bounds"
);

assert(
  /ListCompanionDisplays\([\s\S]+\.Where\(display => !display\.IsPrimary\)/.test(displayManager)
    && /ActiveDisplayCount\s*=\s*active\.Count/.test(displayManager)
    && /CompanionDisplayCount\s*=\s*companions\.Count/.test(displayManager)
    && /EdgeCandidateCount\s*=\s*companions\.Count/.test(displayManager)
    && /waiting-for-companion-display/.test(displayManager)
    && /ResolveCompanionDisplay[\s\S]+selected\.IsPrimary[\s\S]+primary display cannot host Auxora/i.test(displayManager),
  "diagnostics must count companions separately, exclude primary-only readiness, and reject stale or primary targets"
);

assert(
  /monitorDevice\.DeviceId\.Contains\("CRXED00"/.test(displayManager)
    && /RequiresNativeModeCorrection => ContainsXeneonName && !MatchesEdgeResolution/.test(displayManager)
    && /display-mode-mismatch/.test(displayManager)
    && /using \{selected!\.ModeWidth\}x\{selected\.ModeHeight\}/.test(displayManager)
    && /Set Display resolution to 2560 x 720 and refresh rate to 60 Hz/.test(displayManager),
  "a XENEON EDGE running a non-native mode must be identified by hardware ID and reported as a repairable readiness failure"
);

assert(
  /UpdateDashboard\([\s\S]+DisplayManager\.ResolveCompanionDisplay\(payload\.PreferredDisplayId\)/.test(configController)
    && /PreferredDisplayId\s*=\s*selectedCompanionDisplay\?\.StableId/.test(configController)
    && !/payload\.PreferredDisplayDeviceName/.test(configController)
    && /SetDisplayPreference\([\s\S]+DisplayManager\.ResolveCompanionDisplay\(payload\.DisplayId\)/.test(configController)
    && /IsCompanionDisplayReady\([\s\S]+CompanionDisplayCount\s*<\s*1[\s\S]+!display\.Primary/.test(configController)
    && /ConfigController\.IsCompanionDisplayReady\(displayDiagnostics\)/.test(telemetryController)
    && /ConfigController\.IsCompanionDisplayReady\(display\)/.test(supportController),
  "both display preference APIs and all readiness surfaces must require an active non-primary companion"
);

assert(
  /visibleDisplays\s*=\s*displays\.filter[\s\S]+!entry\.primary/.test(setupWidget)
    && /data-companion-display="true"/.test(setupWidget)
    && !/entry\.primary\s*\?\s*"Primary"/.test(setupWidget)
    && /display\s*&&\s*!display\.primary/.test(systemWidget)
    && /companionDisplayCount/.test(systemWidget)
    && !/selectedDisplayFromDiagnostics\(displayDiagnostics\)\s*\|\|\s*primaryDisplayFromSystem/.test(systemWidget),
  "setup and system widgets must not render or reuse the Windows primary display as an Auxora target"
);

assert(
  /EnumWindows/.test(nativeHostApiTest)
    && /EnumDisplayMonitors/.test(nativeHostApiTest)
    && /IsWindowVisible/.test(nativeHostApiTest)
    && /IntersectsPrimary/.test(nativeHostApiTest)
    && /System\.Threading\.Thread\]::Yield/.test(nativeHostApiTest)
    && /effectiveIntervalMs <= 5/.test(nativeHostApiTest)
    && /placementViolations\.length === 0/.test(nativeHostApiTest)
    && /primary-only startup must keep every Auxora top-level window hidden/.test(nativeHostApiTest),
  "launched-host coverage must sample real visible HWND bounds fast enough to catch a 60 Hz primary-display flash"
);

assert(
  !/ChangeDisplaySettings/.test(mainWindow)
    && !/SetDisplayConfig/.test(mainWindow)
    && !/ChangeDisplaySettings/.test(bridgeManager)
    && !/SetDisplayConfig/.test(bridgeManager),
  "native host must not call Windows APIs that change monitor topology or display modes"
);

assert(
  /HandleProcessFailed[\s\S]+ScheduleWebViewRecovery/.test(mainWindow)
    && /ScheduleWebViewRecovery[\s\S]+NavigateDashboard\(forceReload:\s*true\)/.test(mainWindow)
    && /ScheduleWebViewRecovery[\s\S]+_webViewDiagnosticsAttached = false;[\s\S]+await EnsureWebViewReadyAsync/.test(mainWindow)
    && /if\s*\(!DispatcherQueue\.TryEnqueue/.test(mainWindow)
    && /Failed to enqueue WebView recovery[\s\S]+Interlocked\.Exchange\(ref _webViewRecoveryScheduled,\s*0\)/.test(mainWindow),
  "WebView process failures must schedule dashboard recovery, reattach diagnostics, and clear the gate when enqueue fails"
);

assert(
  /SelectDisplayTarget\([\s\S]+IReadOnlyList<DisplayTarget>\?\s+candidates\s*=\s*null,[\s\S]+bool\s+saveSelection\s*=\s*true/.test(bridgeManager)
    && /ValidateActiveCompanionDisplay/.test(bridgeManager)
    && /if\s*\(!saveSelection\)[\s\S]+return selected;/.test(bridgeManager),
  "display selection must support non-persistent recovery after transient monitor changes"
);

assert(
  /physicalCompanionDisplay/.test(displayReceipt)
    && /noPrimaryIntersection/.test(displayReceipt)
    && /trayOnlyWithoutCompanion/.test(displayReceipt)
    && /primaryRoleSwitchFailClosed/.test(displayReceipt)
    && /taskbarHidden/.test(displayReceipt)
    && /touchLongPress/.test(displayReceipt)
    && /screenReaderNames/.test(displayReceipt)
    && /100, 125, 150, 175, 200/.test(displayReceipt)
    && /private screenshot path/.test(displayReceiptFixtures)
    && /Virtual displays, browser emulation, and source tests do not satisfy/.test(displayCertification),
  "physical display qualification must bind the exact candidate and fail closed on primary, taskbar, scaling, touch, and privacy gaps"
);

console.log("checked companion-only startup, first-run, tray, hot-plug, API, UI, and WebView recovery contracts");
