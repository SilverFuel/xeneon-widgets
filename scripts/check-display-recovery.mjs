import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";

const mainWindow = readWorkspaceFile("app/MainWindow.xaml.cs");
const mainWindowXaml = readWorkspaceFile("app/MainWindow.xaml");
const appXaml = readWorkspaceFile("app/App.xaml.cs");
const program = readWorkspaceFile("app/Program.cs");
const appProject = readWorkspaceFile("app/XenonEdgeHost.csproj");
const appManifest = readWorkspaceFile("app/app.manifest");
const trayIcon = readWorkspaceFile("app/TrayIcon.cs");
const bridgeManager = readWorkspaceFile("app/BridgeManager.cs");
const displayManager = readWorkspaceFile("app/Services/DisplayManager.cs");
const configController = readWorkspaceFile("app/Controllers/ConfigController.cs");
const telemetryController = readWorkspaceFile("app/Controllers/TelemetryController.cs");
const supportController = readWorkspaceFile("app/Controllers/SupportController.cs");
const setupWidget = readWorkspaceFile("js/widgets/setup.js");
const systemWidget = readWorkspaceFile("js/widgets/system.js");
const nativeHostApiTest = readWorkspaceFile("scripts/test-native-host-api.mjs");
const renderedDashboardTest = readWorkspaceFile("scripts/test-rendered-dashboard.mjs");
const renderedThemeTest = readWorkspaceFile("scripts/test-theme-rendered.mjs");
const visibleWindowGuard = readWorkspaceFile("scripts/lib/visible-window-guard.mjs");
const installScript = readWorkspaceFile("app/install.ps1");
const displayReceipt = readWorkspaceFile("scripts/Test-DisplayQualificationReceipt.ps1");
const displayReceiptFixtures = readWorkspaceFile("scripts/test-display-qualification-receipt.ps1");
const displayCertification = readWorkspaceFile("docs/release/DISPLAY-CERTIFICATION.md");
const nativeHostSource = readWorkspaceTree("app", new Set([".cs", ".ps1", ".xaml"]));

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

function readWorkspaceTree(relativePath, extensions) {
  const directoryPath = resolve(process.cwd(), relativePath);
  const chunks = [];
  const pending = [directoryPath];
  const ignoredDirectories = new Set(["bin", "dist", "installer-build", "obj"]);

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) {
          pending.push(entryPath);
        }
      } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
        chunks.push(readFileSync(entryPath, "utf8"));
      }
    }
  }

  return chunks.join("\n");
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
  /x:Name="StatusText"[\s\S]{0,160}AutomationProperties\.LiveSetting="Polite"/.test(mainWindowXaml)
    && /x:Name="DisplayPickerStatus"[\s\S]{0,160}AutomationProperties\.LiveSetting="Polite"/.test(mainWindowXaml),
  "native startup and asynchronous display-picker status must be exposed as polite accessibility live regions"
);

assert(
  /\$trigger\.Delay\s*=\s*"PT20S"/.test(installScript),
  "installed startup task must delay launch so display topology can settle after reboot"
);

assert(
  /internal void Start\(\)[\s\S]+ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow)
    && /ShowDisplayWindow[\s\S]+ConfigureWindow\(saveSelection:\s*false\)/.test(mainWindow)
    && !/Activated\s*\+=/.test(mainWindow),
  "automatic launch must not depend on window activation, and tray show must revalidate companion placement without saving display preference"
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
    && /BeginDashboardStartupIfReady[\s\S]+!_windowHasBeenShown && !_suppressWindowForTests[\s\S]+_companionDisplayUnavailable && !_suppressWindowForTests[\s\S]+return/.test(mainWindow)
    && /BeginDashboardStartupIfReady[\s\S]+_dashboardLoaded \|\| DashboardView\.CoreWebView2 is not null[\s\S]+return/.test(mainWindow)
    && /EnsureWebViewReadyAsync[\s\S]+if \(DashboardView\.CoreWebView2 is null\)[\s\S]+CreateWithOptionsAsync[\s\S]+EnsureCoreWebView2Async/.test(mainWindow)
    && /RevealConfiguredWindow[\s\S]+ShowWindowNoActivate\(\);[\s\S]+BeginDashboardStartupIfReady\(\)/.test(mainWindow),
  "native services may start while Auxora is hidden, but WebView2 must initialize only once after a verified companion reveal or an isolated window-suppressed test launch"
);

assert(
  /ShouldSuppressWindowForTests\s*=>\s*ResolveWindowSuppression/.test(program)
    && /ResolveWindowSuppression[\s\S]+Suppressing the Auxora window is allowed only for an isolated automated test instance/.test(program)
    && /if \(_suppressWindowForTests\)[\s\S]+ShowWindow\(_windowHandle, SwHide\);[\s\S]+InitializeHostAsync\(\);[\s\S]+return;/.test(mainWindow)
    && /RevealConfiguredWindow\(\)[\s\S]+if \(_suppressWindowForTests\)[\s\S]+ShowWindow\(_windowHandle, SwHide\);[\s\S]+return false;/.test(mainWindow)
    && /ScheduleDisplayRecovery\(string reason\)[\s\S]+_suppressWindowForTests/.test(mainWindow)
    && /ResolveWebViewUserDataPath\([\s\S]+_suppressWindowForTests \? AppPaths\.LocalDataDirectory : null/.test(mainWindow)
    && /return Path\.Combine\(isolatedLocalDataDirectory, "WebView2"\)/.test(mainWindow)
    && /return Path\.Combine\(productionLocalApplicationDataRoot, "XenonEdgeHost", "WebView2"\)/.test(mainWindow)
    && /AUXORA_SUPPRESS_WINDOW_FOR_TESTS:\s*"1"/.test(renderedDashboardTest)
    && /AUXORA_SUPPRESS_WINDOW_FOR_TESTS:\s*"1"/.test(renderedThemeTest)
    && /spawnWithVisibleWindowGuard/.test(renderedDashboardTest)
    && /spawnWithVisibleWindowGuard/.test(renderedThemeTest)
    && /IsWindowVisible/.test(visibleWindowGuard)
    && /Stop-Process -Id \$targetProcessId -Force/.test(visibleWindowGuard),
  "headless rendered tests must suppress every native reveal, isolate WebView data, and terminate on any visible top-level window"
);

assert(
  /<ApplicationManifest>app\.manifest<\/ApplicationManifest>/.test(appProject)
    && /<dpiAware[^>]*>true\/pm<\/dpiAware>/.test(appManifest)
    && /<dpiAwareness[^>]*>PerMonitorV2,PerMonitor<\/dpiAwareness>/.test(appManifest),
  "the unpackaged native host must use per-monitor-v2 DPI coordinates on mixed-scale displays"
);

assert(
  !/\bActivate\(\);/.test(mainWindow)
    && !/SetForegroundWindow/.test(mainWindow)
    && /if \(_waitingForEdgeDisplay\)[\s\S]+ShowWindow\(windowHandle, SwShowNoActivate\)/.test(mainWindow)
    && /ShowWindowNoActivate\(\);[\s\S]+_windowHasBeenShown = true;/.test(mainWindow),
  "automatic startup, recovery, and display-picker reveals must never take foreground focus"
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
  /HandleDisplaySettingsChanged[\s\S]+ScheduleDisplayTopologyRevalidation\(\)/.test(mainWindow)
    && /DisplayTopologyDebounceDelay\s*=\s*TimeSpan\.FromMilliseconds\(750\)/.test(mainWindow)
    && /ScheduleDisplayTopologyRevalidation[\s\S]+firstInBurst[\s\S]+ShowWindow\(_windowHandle, SwHide\)[\s\S]+RevalidateDisplayTopologyAfterQuietPeriodAsync/.test(mainWindow)
    && /RevalidateDisplayTopologyAfterQuietPeriodAsync[\s\S]+var cancellationToken = request\.Token[\s\S]+Task\.Delay\(DisplayTopologyDebounceDelay, cancellationToken\)[\s\S]+ConfigureWindow\(saveSelection:\s*false\)[\s\S]+RevealConfiguredWindow\(\)/.test(mainWindow)
    && /completion\.Task\.WaitAsync\(cancellationToken\)/.test(mainWindow)
    && /CancelCancellationSource\(previousRequest\)/.test(mainWindow)
    && /CancelCancellationSource\(displayTopologyChangeCancellation\)/.test(mainWindow)
    && /CancelCancellationSource[\s\S]+catch \(ObjectDisposedException\)/.test(mainWindow)
    && /TryRecoverDisplayPlacementAsync[\s\S]+var recovered = ConfigureWindow\(saveSelection:\s*false\)[\s\S]+if\s*\(recovered\)[\s\S]+RevealConfiguredWindow\(\)/.test(mainWindow)
    && /ShowDisplayWindow\(\)[\s\S]+SwHide[\s\S]+ConfigureWindow\(saveSelection:\s*false\)[\s\S]+RevealConfiguredWindow\(\)/.test(mainWindow),
  "display-event storms must hide once and debounce reconfiguration, while recovery and tray show reveal only after companion placement succeeds"
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
    && !/RequiresNativeModeCorrection\s*=>/.test(displayManager)
    && /RequiresNativeModeCorrection\s*=\s*false/.test(displayManager)
    && !/display-mode-mismatch/.test(displayManager)
    && !/Set Display resolution/.test(displayManager)
    && /BuildStableDisplayId\(DeviceName, DeviceId, FriendlyName\)/.test(displayManager)
    && !/BuildStableDisplayId\([^)]*ModeWidth/.test(displayManager)
    && /MatchesLegacyModeDependentId/.test(displayManager),
  "display identity and readiness must not depend on Windows resolution or refresh rate, while saved legacy identifiers remain compatible"
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
    && /ContainedByCompanion/.test(nativeHostApiTest)
    && /GetForegroundWindow/.test(nativeHostApiTest)
    && /SetProcessDpiAwarenessContext/.test(nativeHostApiTest)
    && /System\.Threading\.Thread\]::Yield/.test(nativeHostApiTest)
    && /effectiveIntervalMs <= 5/.test(nativeHostApiTest)
    && /placementViolations\.length === 0/.test(nativeHostApiTest)
    && /primary-only startup must keep every Auxora top-level window hidden/.test(nativeHostApiTest),
  "launched-host coverage must catch primary-display flashes, oversized companion windows, and foreground theft in physical coordinates"
);

assert(
  !/\b(?:ChangeDisplaySettings(?:Ex)?|SetDisplayConfig|DisplaySwitch|DisplayConfigSetDeviceInfo|SetDeviceGammaRamp|SetICMMode|WcsSetDefaultColorProfile|SetColorProfileElement|InstallColorProfile|UninstallColorProfile)\b/i.test(nativeHostSource),
  "native host source must not call Windows APIs that change monitor topology, display modes, gamma ramps, or Windows color profiles"
);

assert(
  /HandleProcessFailed[\s\S]+ScheduleWebViewRecovery/.test(mainWindow)
    && /ScheduleWebViewRecovery[\s\S]+NavigateDashboard\(forceReload:\s*true\)/.test(mainWindow)
    && /ScheduleWebViewRecovery[\s\S]+await EnsureWebViewReadyAsync\(\)/.test(mainWindow)
    && !/EnsureWebViewReadyAsync\(resetDiagnostics/.test(mainWindow)
    && /AttachWebViewDiagnosticsAsync[\s\S]+ReferenceEquals\(_webViewDiagnosticsWebView, webView\)[\s\S]+return;/.test(mainWindow)
    && /DetachWebViewDiagnostics[\s\S]+WebMessageReceived -= HandleWebMessageReceived[\s\S]+ProcessFailed -= HandleProcessFailed[\s\S]+RemoveWebViewDiagnosticsScript/.test(mainWindow)
    && /RemoveScriptToExecuteOnDocumentCreated\(scriptId\)/.test(mainWindow)
    && /_webViewDiagnosticsWebView/.test(mainWindow)
    && /_webViewDiagnosticsScriptId/.test(mainWindow)
    && /DisposeResources[\s\S]+DetachWebViewDiagnostics\(\)/.test(mainWindow)
    && /if\s*\(!DispatcherQueue\.TryEnqueue/.test(mainWindow)
    && /Failed to enqueue WebView recovery[\s\S]+Interlocked\.Exchange\(ref _webViewRecoveryScheduled,\s*0\)/.test(mainWindow),
  "WebView process failures must reuse an existing diagnostics registration, clean it up on replacement or disposal, and clear the gate when enqueue fails"
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
