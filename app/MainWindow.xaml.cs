using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using System.Diagnostics;
using System.Runtime.InteropServices;
using WinRT.Interop;
using Windows.Graphics;

namespace XenonEdgeHost;

public sealed partial class MainWindow : Window
{
    private const int GwlExStyle = -20;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExAppWindow = 0x00040000L;
    private const long WsExNoActivate = 0x08000000L;
    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpFrameChanged = 0x0020;
    private const uint SwpShowWindow = 0x0040;
    private const int SwHide = 0;
    private const int SwShowNoActivate = 4;
    private const int WaitingWindowWidth = 1120;
    private const int WaitingWindowHeight = 720;
    private static readonly TimeSpan PersistentDisplayRecoveryDelay = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan[] DisplayRecoveryDelays =
    [
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(4),
        TimeSpan.FromSeconds(7),
        TimeSpan.FromSeconds(10)
    ];
    private static readonly IntPtr HwndTopmost = new(-1);
    private static readonly IntPtr HwndNoTopmost = new(-2);

    private readonly BridgeManager _bridgeManager;
    private readonly IntPtr _windowHandle;
    private TrayIcon? _trayIcon;
    private readonly HostLogger _logger = App.Logger;
    private readonly Uri _dashboardUri;
    private readonly Uri _settingsUri;
    private readonly string _webViewUserDataPath;
    private bool _initialized;
    private bool _disposed;
    private bool _webViewInitializationFailed;
    private bool _webViewDiagnosticsAttached;
    private bool _dashboardLoaded;
    private bool _bridgeReady;
    private bool _taskbarStyleApplied;
    private bool _waitingForEdgeDisplay;
    private bool _companionDisplayUnavailable;
    private bool _windowHasBeenShown;
    private bool _displayMoveMode;
    private string _configuredDisplayId = "";
    private ulong _dashboardNavigationId;
    private int _quitRequested;
    private int _navigationFailures;
    private int _dashboardStartupScheduled;
    private int _webViewRecoveryScheduled;
    private int _displayRecoveryScheduled;
    private int _displayMoveConstraintQueued;
    private int _lockedPresentationGeneration;
    private EventWaitHandle? _showDisplayEvent;
    private RegisteredWaitHandle? _showDisplayWaitHandle;
    private CancellationTokenSource? _displayRecoveryCancellation;

    public MainWindow()
    {
        InitializeComponent();

        _windowHandle = WindowNative.GetWindowHandle(this);
        _bridgeManager = new BridgeManager();
        _dashboardUri = _bridgeManager.DashboardUri;
        _settingsUri = _bridgeManager.SettingsUri;
        _webViewUserDataPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "XenonEdgeHost",
            "WebView2");

        _bridgeManager.StatusChanged += HandleBridgeStatusChanged;
        _bridgeManager.BridgeReady += HandleBridgeReady;
        _bridgeManager.BridgeStopped += HandleBridgeStopped;
        _bridgeManager.DisplayPreferenceChanged += HandleDisplayPreferenceChanged;
        _bridgeManager.QuitRequested += HandleRecoveryQuitRequested;
        _bridgeManager.SetBrowserDataClearer(ClearWebViewBrowsingDataAsync);

        AppWindow.Closing += HandleAppWindowClosing;
        AppWindow.Changed += HandleAppWindowChanged;
        Activated += HandleActivated;
        Closed += HandleClosed;
        DashboardView.NavigationStarting += HandleNavigationStarting;
        DashboardView.NavigationCompleted += HandleNavigationCompleted;
        SystemEvents.DisplaySettingsChanged += HandleDisplaySettingsChanged;
        StartShowDisplaySignalListener();
    }

    internal void Start()
    {
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        _trayIcon ??= new TrayIcon(
            _windowHandle,
            onOpenSettings: () => DispatcherQueue.TryEnqueue(() => _ = OpenSettingsAsync()),
            onRestartBridge: () => DispatcherQueue.TryEnqueue(() => _ = RestartBridgeAsync()),
            onShowDisplay: () => DispatcherQueue.TryEnqueue(ShowDisplayWindow),
            onMoveDisplay: () => DispatcherQueue.TryEnqueue(BeginDisplayMoveMode),
            onOpenLogs: () => DispatcherQueue.TryEnqueue(OpenLogs),
            onResetDashboard: () => DispatcherQueue.TryEnqueue(() => _ = ResetDashboardStateAsync()),
            onQuit: RequestQuitFromTray,
            logger: _logger);
        var placementReady = ConfigureWindow(saveSelection: false);
        if (placementReady)
        {
            RevealConfiguredWindow();
        }
        ScheduleDisplayRecovery("startup display backoff");
        _ = InitializeHostAsync();
    }

    private void HandleActivated(object sender, WindowActivatedEventArgs args)
    {
        // Startup is explicit so a later user-initiated activation remains harmless.
        Start();
    }

    private bool ConfigureWindow(bool saveSelection)
    {
        _displayMoveMode = false;
        var windowHandle = _windowHandle;
        if (windowHandle != IntPtr.Zero)
        {
            ShowWindow(windowHandle, SwHide);
        }

        var safeMode = Program.LaunchOptions.SafeMode;
        List<DisplayTarget> displayCandidates;
        try
        {
            displayCandidates = _bridgeManager
                .ListDisplayCandidates(ignoreSavedPreference: safeMode)
                .Where(display => !display.IsPrimary)
                .ToList();
        }
        catch (Exception error)
        {
            _logger.Warn($"Companion display enumeration failed: {error.Message}");
            EnterCompanionDisplayWaitingState(windowHandle, "Windows could not verify a companion display.");
            return false;
        }

        if (displayCandidates.Count == 0)
        {
            EnterCompanionDisplayWaitingState(windowHandle, "Connect or enable a non-primary companion display to use Auxora.");
            return false;
        }

        var needsDisplaySelection = !safeMode && displayCandidates.Count > 1 && displayCandidates.All(display => !display.IsPreferred);
        DisplayTarget targetDisplay;
        try
        {
            targetDisplay = _bridgeManager.SelectDisplayTarget(
                displayCandidates,
                saveSelection: saveSelection && !safeMode);
        }
        catch (Exception error)
        {
            _logger.Warn($"Companion display selection failed: {error.Message}");
            EnterCompanionDisplayWaitingState(windowHandle, "Auxora could not verify a safe companion-display target.");
            return false;
        }

        if (targetDisplay.IsPrimary)
        {
            _logger.Error("Display policy returned the Windows primary display. Auxora refused to show its window.");
            EnterCompanionDisplayWaitingState(windowHandle, "Auxora refused an unsafe primary-display target.");
            return false;
        }

        var appWindow = AppWindow;

        appWindow.SetPresenter(AppWindowPresenterKind.Overlapped);
        if (appWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.SetBorderAndTitleBar(false, false);
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
        }

        if (needsDisplaySelection)
        {
            ApplyDisplaySelectionWindow(appWindow, windowHandle, targetDisplay, displayCandidates);
            return true;
        }

        _configuredDisplayId = targetDisplay.StableId;
        appWindow.MoveAndResize(new RectInt32(
            targetDisplay.Bounds.X,
            targetDisplay.Bounds.Y,
            targetDisplay.Bounds.Width,
            targetDisplay.Bounds.Height));
        appWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
        EnsureDisplayWindowStaysOffTaskbar(windowHandle);
        _companionDisplayUnavailable = false;
        _waitingForEdgeDisplay = false;
        DisplayPickerPanel.Visibility = Visibility.Collapsed;
        DashboardView.Visibility = Visibility.Visible;

        _logger.Info("Display candidates: " + string.Join(" | ", displayCandidates.Select(DescribeDisplayCandidate)));
        _logger.Info($"{(safeMode ? "Safe Mode: " : "")}Window positioned on {targetDisplay.Label} (score {targetDisplay.Score}).");
        if (!_dashboardLoaded)
        {
            SetOverlayText(safeMode
                ? $"Safe Mode: launching on companion display ({targetDisplay.Label})."
                : $"Launching on {targetDisplay.Label}.");
        }
        else
        {
            OverlayPanel.Visibility = Visibility.Collapsed;
        }

        return true;
    }

    private void EnterCompanionDisplayWaitingState(IntPtr windowHandle, string message)
    {
        if (windowHandle != IntPtr.Zero)
        {
            ShowWindow(windowHandle, SwHide);
        }

        _companionDisplayUnavailable = true;
        _displayMoveMode = false;
        _waitingForEdgeDisplay = false;
        _configuredDisplayId = "";
        DisplayPickerPanel.Visibility = Visibility.Collapsed;
        DashboardView.Visibility = Visibility.Collapsed;
        OverlayPanel.Visibility = Visibility.Visible;
        StatusText.Text = message;
        _logger.Info($"Auxora is staying hidden: {message}");
    }

    private void ApplyDisplaySelectionWindow(
        AppWindow appWindow,
        IntPtr windowHandle,
        DisplayTarget pickerDisplay,
        IReadOnlyList<DisplayTarget> displayCandidates)
    {
        appWindow.SetPresenter(AppWindowPresenterKind.Overlapped);
        if (appWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.SetBorderAndTitleBar(true, true);
            presenter.IsResizable = true;
            presenter.IsMaximizable = true;
            presenter.IsMinimizable = true;
        }

        RestoreDisplayWindowToTaskbar(windowHandle);

        _configuredDisplayId = pickerDisplay.StableId;
        appWindow.MoveAndResize(BuildDisplaySelectionBounds(pickerDisplay));
        _companionDisplayUnavailable = false;
        _waitingForEdgeDisplay = true;

        _logger.Info("Display candidates: " + string.Join(" | ", displayCandidates.Select(DescribeDisplayCandidate)));
        _logger.Info($"Auxora needs a preferred display; showing display selection on {pickerDisplay.Label}.");
        ShowDisplayPicker(displayCandidates);
    }

    private static RectInt32 BuildDisplaySelectionBounds(DisplayTarget display)
    {
        var availableWidth = Math.Max(320, display.Bounds.Width - 64);
        var availableHeight = Math.Max(240, display.Bounds.Height - 32);
        var width = Math.Min(WaitingWindowWidth, availableWidth);
        var height = Math.Min(WaitingWindowHeight, availableHeight);
        var x = display.Bounds.X + Math.Max(0, (display.Bounds.Width - width) / 2);
        var y = display.Bounds.Y + Math.Max(0, (display.Bounds.Height - height) / 2);
        return new RectInt32(x, y, width, height);
    }

    private void ShowDisplayPicker(IReadOnlyList<DisplayTarget> displayCandidates)
    {
        DisplayPickerList.Children.Clear();
        for (var index = 0; index < displayCandidates.Count; index++)
        {
            var display = displayCandidates[index];
            var displayName = string.IsNullOrWhiteSpace(display.FriendlyName)
                ? display.IsPrimary ? "Primary display" : $"Display {index + 1}"
                : display.FriendlyName;
            var refreshRate = display.RefreshRate is double rate ? $" • {rate:0.#} Hz" : "";
            var primaryLabel = display.IsPrimary ? " • Primary" : "";

            var content = new StackPanel { Spacing = 5 };
            content.Children.Add(new TextBlock
            {
                Text = displayName,
                Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 245, 248, 250)),
                FontSize = 19,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                TextWrapping = TextWrapping.WrapWholeWords
            });
            content.Children.Add(new TextBlock
            {
                Text = $"{display.Bounds.Width} × {display.Bounds.Height}{refreshRate}{primaryLabel}",
                Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 184, 199, 209)),
                FontSize = 14,
                TextWrapping = TextWrapping.WrapWholeWords
            });
            content.Children.Add(new TextBlock
            {
                Text = $"Windows position {display.Bounds.X}, {display.Bounds.Y} — tap to use this display",
                Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 116, 221, 255)),
                FontSize = 13,
                TextWrapping = TextWrapping.WrapWholeWords
            });

            var button = new Button
            {
                Tag = display.StableId,
                Content = content,
                Padding = new Thickness(18, 14, 18, 14),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                MinHeight = 88,
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 25, 39, 49)),
                BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(102, 0, 217, 255)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(14)
            };
            button.Click += HandleDisplayChoice;
            DisplayPickerList.Children.Add(button);
        }

        DisplayPickerStatus.Text = displayCandidates.Count == 0
            ? "No active displays were found. Check the cable, then refresh."
            : "Choose one display to continue. You can change it later in Settings → Diagnostics.";
        DisplayPickerStatus.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(
            255,
            displayCandidates.Count == 0 ? (byte)255 : (byte)145,
            displayCandidates.Count == 0 ? (byte)165 : (byte)168,
            displayCandidates.Count == 0 ? (byte)120 : (byte)183));
        OverlayPanel.Visibility = Visibility.Collapsed;
        DashboardView.Visibility = Visibility.Collapsed;
        DisplayPickerPanel.Visibility = Visibility.Visible;
    }

    private void HandleDisplayChoice(object sender, RoutedEventArgs args)
    {
        if (sender is not Button { Tag: string displayId } || string.IsNullOrWhiteSpace(displayId))
        {
            return;
        }

        foreach (var child in DisplayPickerList.Children.OfType<Button>())
        {
            child.IsEnabled = false;
        }

        DisplayPickerStatus.Text = "Moving Auxora and saving your choice...";
        try
        {
            _displayMoveMode = false;
            _bridgeManager.SetDisplayPreference(displayId);
        }
        catch (Exception error)
        {
            _logger.Error("Native display selection failed", error);
            ShowWindow(_windowHandle, SwHide);
            if (ConfigureWindow(saveSelection: false))
            {
                DisplayPickerStatus.Text = "That display is no longer available. Choose an active companion display.";
                DisplayPickerStatus.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 255, 165, 120));
                foreach (var child in DisplayPickerList.Children.OfType<Button>())
                {
                    child.IsEnabled = true;
                }
                RevealConfiguredWindow();
            }
            else
            {
                ScheduleDisplayRecovery("selected companion display became unavailable");
            }
        }
    }

    private void HandleRefreshDisplays(object sender, RoutedEventArgs args)
    {
        try
        {
            ShowWindow(_windowHandle, SwHide);
            var displayCandidates = _bridgeManager
                .ListDisplayCandidates(ignoreSavedPreference: true)
                .Where(display => !display.IsPrimary)
                .ToList();
            if (displayCandidates.Count == 0)
            {
                EnterCompanionDisplayWaitingState(_windowHandle, "Connect or enable a non-primary companion display to use Auxora.");
                ScheduleDisplayRecovery("display picker refresh found no companion display");
                return;
            }

            var pickerDisplay = _bridgeManager.SelectDisplayTarget(displayCandidates, saveSelection: false);
            ApplyDisplaySelectionWindow(AppWindow, _windowHandle, pickerDisplay, displayCandidates);
            RevealConfiguredWindow();
        }
        catch (Exception error)
        {
            _logger.Error("Display picker refresh failed", error);
            EnterCompanionDisplayWaitingState(_windowHandle, "Windows could not safely refresh the companion-display list.");
            ScheduleDisplayRecovery("display picker refresh failed");
        }
    }

    private void HandleOpenWindowsDisplaySettings(object sender, RoutedEventArgs args)
    {
        try
        {
            Process.Start(new ProcessStartInfo("ms-settings:display") { UseShellExecute = true });
        }
        catch (Exception error)
        {
            _logger.Error("Opening Windows display settings failed", error);
            DisplayPickerStatus.Text = "Windows display settings could not be opened. Use Settings → System → Display.";
        }
    }

    private void HandleDisplaySettingsChanged(object? sender, EventArgs args)
    {
        // Windows can promote a surviving monitor to primary before the delayed
        // recovery pass runs. Hide synchronously, then revalidate on the UI thread.
        if (_windowHandle != IntPtr.Zero)
        {
            ShowWindow(_windowHandle, SwHide);
        }

        _logger.Info("Display topology changed; hiding Auxora until companion placement is revalidated.");
        DispatcherQueue.TryEnqueue(() =>
        {
            if (_disposed)
            {
                return;
            }

            _displayMoveMode = false;
            if (ConfigureWindow(saveSelection: false))
            {
                RevealConfiguredWindow();
            }
        });
        ScheduleDisplayRecovery("display topology changed");
    }

    private void HandleDisplayPreferenceChanged()
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            _displayMoveMode = false;
            ShowWindow(_windowHandle, SwHide);
            if (ConfigureWindow(saveSelection: false))
            {
                RevealConfiguredWindow();
                _logger.Info("Auxora moved to the newly selected companion display.");
            }
        });
    }

    private void ScheduleDisplayRecovery(string reason)
    {
        if (_disposed || Interlocked.Exchange(ref _displayRecoveryScheduled, 1) == 1)
        {
            return;
        }

        _displayRecoveryCancellation?.Cancel();
        _displayRecoveryCancellation?.Dispose();
        _displayRecoveryCancellation = new CancellationTokenSource();
        var token = _displayRecoveryCancellation.Token;

        _ = Task.Run(async () =>
        {
            try
            {
                var attempt = 0;
                while (!_disposed && !token.IsCancellationRequested)
                {
                    var delay = attempt < DisplayRecoveryDelays.Length
                        ? DisplayRecoveryDelays[attempt]
                        : PersistentDisplayRecoveryDelay;
                    await Task.Delay(delay, token);
                    if (_disposed || token.IsCancellationRequested)
                    {
                        return;
                    }

                    var recovered = await TryRecoverDisplayPlacementAsync(reason, token);
                    if (recovered)
                    {
                        return;
                    }

                    attempt++;
                }
            }
            catch (OperationCanceledException)
            {
            }
            finally
            {
                Interlocked.Exchange(ref _displayRecoveryScheduled, 0);
            }
        }, token);
    }

    private Task<bool> TryRecoverDisplayPlacementAsync(string reason, CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!DispatcherQueue.TryEnqueue(() =>
        {
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                var recovered = ConfigureWindow(saveSelection: false);
                if (recovered)
                {
                    recovered = RevealConfiguredWindow();
                }

                _logger.Info($"Display recovery pass after {reason}: companionPlacementReady={recovered}.");
                completion.TrySetResult(recovered);
            }
            catch (Exception error)
            {
                _logger.Warn($"Display recovery pass failed after {reason}: {error.Message}");
                completion.TrySetResult(false);
            }
        }))
        {
            completion.TrySetResult(false);
        }

        return completion.Task;
    }

    private static string DescribeDisplayCandidate(DisplayTarget display)
    {
        return $"{display.Label}; id={display.StableId}; primary={display.IsPrimary}; preferred={display.IsPreferred}; score={display.Score}; bounds={display.Bounds.X},{display.Bounds.Y},{display.Bounds.Width}x{display.Bounds.Height}; reasons={string.Join(",", display.MatchReasons)}";
    }

    private async Task InitializeHostAsync()
    {
        try
        {
            SetOverlayText("Starting native dashboard services...");
            _logger.Info("Starting native dashboard services.");
            await _bridgeManager.StartAsync();
        }
        catch (Exception error)
        {
            _logger.Error("Host initialization failed", error);
            SetOverlayText(_webViewInitializationFailed ? BuildWebView2HelpText() : $"Startup failed: {error.Message}");
        }
    }

    private async Task EnsureWebViewReadyAsync()
    {
        try
        {
            Directory.CreateDirectory(_webViewUserDataPath);
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(
                browserExecutableFolder: null,
                userDataFolder: _webViewUserDataPath,
                options: null);
            await DashboardView.EnsureCoreWebView2Async(environment);
            _webViewInitializationFailed = false;
        }
        catch (Exception error)
        {
            _webViewInitializationFailed = true;
            _logger.Error("WebView2 initialization failed", error);
            SetOverlayText(BuildWebView2HelpText());
            throw;
        }

        if (DashboardView.CoreWebView2 is null)
        {
            throw new InvalidOperationException("WebView2 did not initialize correctly.");
        }

        DashboardView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        DashboardView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
        DashboardView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        DashboardView.CoreWebView2.Settings.IsZoomControlEnabled = false;

        if (_webViewDiagnosticsAttached)
        {
            return;
        }

        DashboardView.CoreWebView2.WebMessageReceived += HandleWebMessageReceived;
        DashboardView.CoreWebView2.ProcessFailed += HandleProcessFailed;
        await DashboardView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
            """
            (() => {
              if (!window.chrome || !window.chrome.webview || window.__xenonDiagnosticsInstalled) {
                return;
              }

              window.__xenonDiagnosticsInstalled = true;

              function post(kind, payload) {
                try {
                  window.chrome.webview.postMessage(JSON.stringify(Object.assign({ kind }, payload || {})));
                } catch {}
              }

              window.addEventListener("error", function (event) {
                if (event && event.target && event.target !== window) {
                  post("asset-error", {
                    message: event.target.src || event.target.href || event.target.tagName || "asset load failure"
                  });
                  return;
                }

                post("window-error", {
                  message: event && event.message ? String(event.message) : "Unknown error",
                  source: event && event.filename ? String(event.filename) : "",
                  line: event && typeof event.lineno === "number" ? event.lineno : 0,
                  column: event && typeof event.colno === "number" ? event.colno : 0,
                  stack: event && event.error && event.error.stack ? String(event.error.stack) : ""
                });
              }, true);

              window.addEventListener("unhandledrejection", function (event) {
                const reason = event && event.reason;
                post("unhandled-rejection", {
                  message: reason && reason.message ? String(reason.message) : String(reason || "Unknown rejection"),
                  stack: reason && reason.stack ? String(reason.stack) : ""
                });
              });
            })();
            """);
        _webViewDiagnosticsAttached = true;
    }

    private static string BuildWebView2HelpText()
    {
        var runtime = App.RuntimeInfo;

        if (!runtime.IsAvailable)
        {
            return
                "WebView2 Runtime is not available.\n\n" +
                "Install the Evergreen WebView2 Runtime from:\n" +
                "https://developer.microsoft.com/en-us/microsoft-edge/webview2/";
        }

        if (runtime.IsFixedVersion)
        {
            var lines = new List<string>
            {
                "The bundled WebView2 runtime could not start.",
                "",
                $"Runtime path: {runtime.RuntimePath}",
                ""
            };

            if (runtime.RequiresWindows10Permissions)
            {
                lines.Add("On Windows 10, unpackaged fixed runtimes need extra folder permissions.");
                lines.Add("Run install.ps1 to re-apply the FixedRuntime permissions, then try again.");
            }
            else
            {
                lines.Add("Check that the FixedRuntime folder is complete and stored on a local drive.");
            }

            return string.Join(Environment.NewLine, lines);
        }

        return
            "WebView2 failed to initialize.\n\n" +
            $"Detected runtime: {runtime.Version ?? "unknown"}\n\n" +
            "If this machine does not allow the Evergreen runtime to start cleanly, bundle a FixedRuntime folder with the published app.";
    }

    private void NavigateDashboard(bool forceReload)
    {
        if (DashboardView.CoreWebView2 is null)
        {
            return;
        }

        if (DashboardView.Source is null || DashboardView.Source != _dashboardUri)
        {
            _dashboardLoaded = false;
            SetOverlayText("Loading dashboard...");
            DashboardView.Source = _dashboardUri;
            return;
        }

        if (forceReload)
        {
            _dashboardLoaded = false;
            SetOverlayText("Reloading dashboard...");
            DashboardView.Reload();
        }
    }

    private void HandleNavigationStarting(WebView2 sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (!IsDashboardAddress(args.Uri))
        {
            return;
        }

        _dashboardNavigationId = args.NavigationId;
        _dashboardLoaded = false;
    }

    private bool IsDashboardAddress(string? address)
    {
        return Uri.TryCreate(address, UriKind.Absolute, out var candidate)
            && IsDashboardSource(candidate);
    }

    private bool IsDashboardSource(Uri? candidate)
    {
        return candidate is not null
            && Uri.Compare(
                candidate,
                _dashboardUri,
                UriComponents.SchemeAndServer | UriComponents.Path,
                UriFormat.SafeUnescaped,
                StringComparison.OrdinalIgnoreCase) == 0;
    }

    private void HandleNavigationCompleted(WebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        var matchesDashboardNavigation = _dashboardNavigationId != 0
            && args.NavigationId == _dashboardNavigationId;
        var sourceIsDashboard = IsDashboardSource(sender.Source);

        if (args.IsSuccess && matchesDashboardNavigation && sourceIsDashboard)
        {
            _navigationFailures = 0;
            _dashboardLoaded = true;
            if (_waitingForEdgeDisplay)
            {
                var wasVisible = IsWindowVisible(_windowHandle);
                if (ConfigureWindow(saveSelection: false))
                {
                    if (wasVisible)
                    {
                        RevealConfiguredWindow();
                    }
                }
                else
                {
                    ScheduleDisplayRecovery("dashboard loaded while companion display was unavailable");
                }
            }
            else
            {
                OverlayPanel.Visibility = Visibility.Collapsed;
            }
            _logger.Info("Dashboard loaded successfully.");
            return;
        }

        if (args.IsSuccess)
        {
            var source = sender.Source?.GetLeftPart(UriPartial.Path) ?? "unknown source";
            _logger.Info($"Ignoring successful non-dashboard navigation completion from {source}.");
            if (matchesDashboardNavigation && _navigationFailures == 0)
            {
                _navigationFailures = 1;
                SetOverlayText("Finishing dashboard startup...");
                _ = RetryNavigationAsync(_navigationFailures);
            }
            return;
        }

        if (!matchesDashboardNavigation)
        {
            _logger.Info($"Ignoring non-dashboard navigation failure: {args.WebErrorStatus}.");
            return;
        }

        _navigationFailures++;
        var failureAttempt = _navigationFailures;
        var transientStartupAbort = failureAttempt == 1
            && args.WebErrorStatus == CoreWebView2WebErrorStatus.ConnectionAborted;
        if (transientStartupAbort)
        {
            _logger.Info("Dashboard startup navigation was interrupted once; waiting for the current navigation before retrying.");
        }
        else
        {
            _logger.Warn($"Dashboard navigation failed: {args.WebErrorStatus} (attempt {failureAttempt}).");
        }

        if (failureAttempt <= 3)
        {
            SetOverlayText(transientStartupAbort
                ? "Finishing dashboard startup..."
                : $"Dashboard loading failed ({args.WebErrorStatus}). Retrying...");
            _ = RetryNavigationAsync(failureAttempt);
            return;
        }

        SetOverlayText($"Dashboard failed to load after {failureAttempt} attempts.\n{args.WebErrorStatus}\n\nUse the tray icon to restart the server.");
    }

    private void HandleWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            _logger.Warn($"WebView message: {args.TryGetWebMessageAsString()}");
        }
        catch (Exception error)
        {
            _logger.Error("Failed to read WebView diagnostics message", error);
        }
    }

    private void HandleProcessFailed(CoreWebView2 sender, CoreWebView2ProcessFailedEventArgs args)
    {
        _logger.Error($"WebView process failed: {args.ProcessFailedKind}");
        ScheduleWebViewRecovery($"WebView process failed: {args.ProcessFailedKind}");
    }

    private async Task RetryNavigationAsync(int failureAttempt)
    {
        await Task.Delay(2000);

        if (_disposed || _dashboardLoaded || _navigationFailures != failureAttempt)
        {
            return;
        }

        NavigateDashboard(forceReload: true);
    }

    private void ScheduleWebViewRecovery(string reason)
    {
        if (_disposed || Interlocked.Exchange(ref _webViewRecoveryScheduled, 1) == 1)
        {
            return;
        }

        if (!DispatcherQueue.TryEnqueue(async () =>
        {
            try
            {
                var wasVisible = IsWindowVisible(_windowHandle);
                var placementReady = ConfigureWindow(saveSelection: false);
                if (placementReady && wasVisible)
                {
                    RevealConfiguredWindow();
                }
                SetOverlayText("Recovering dashboard display...");
                _logger.Warn($"Recovering dashboard after {reason}.");
                await Task.Delay(1000);
                if (_disposed)
                {
                    return;
                }

                _webViewDiagnosticsAttached = false;
                await EnsureWebViewReadyAsync();
                _navigationFailures = 0;
                NavigateDashboard(forceReload: true);
            }
            catch (Exception error)
            {
                _logger.Error("WebView recovery failed.", error);
                SetOverlayText($"Dashboard display recovery failed.\n{error.Message}\n\nUse the tray icon to restart the server.");
            }
            finally
            {
                Interlocked.Exchange(ref _webViewRecoveryScheduled, 0);
            }
        }))
        {
            _logger.Warn("Failed to enqueue WebView recovery. Clearing recovery gate.");
            Interlocked.Exchange(ref _webViewRecoveryScheduled, 0);
        }
    }

    private void HandleBridgeStatusChanged(string message)
    {
        _logger.Info($"Server: {message}");
        DispatcherQueue.TryEnqueue(() => SetOverlayText(message));
    }

    private void HandleBridgeReady()
    {
        _bridgeReady = true;
        _logger.Info("Native dashboard server ready.");
        if (!DispatcherQueue.TryEnqueue(BeginDashboardStartupIfReady))
        {
            _logger.Warn("Native dashboard is ready, but WebView2 startup could not be queued.");
        }
    }

    private void BeginDashboardStartupIfReady()
    {
        if (_disposed || !_bridgeReady || !_windowHasBeenShown || _companionDisplayUnavailable)
        {
            _logger.Info("Native dashboard server is ready; WebView2 remains deferred until a verified companion display is revealed.");
            return;
        }

        if (Interlocked.Exchange(ref _dashboardStartupScheduled, 1) == 1)
        {
            return;
        }

        _ = InitializeDashboardAfterBridgeReadyAsync();
    }

    private async Task InitializeDashboardAfterBridgeReadyAsync()
    {
        try
        {
            SetOverlayText("Initializing WebView2...");
            await EnsureWebViewReadyAsync();
            _navigationFailures = 0;
            NavigateDashboard(forceReload: true);
        }
        catch (Exception error)
        {
            _logger.Error("Failed to load dashboard after bridge ready", error);
            SetOverlayText(_webViewInitializationFailed ? BuildWebView2HelpText() : error.Message);
        }
        finally
        {
            Interlocked.Exchange(ref _dashboardStartupScheduled, 0);
        }
    }

    private void HandleBridgeStopped(string message)
    {
        _bridgeReady = false;
        _logger.Warn($"Server stopped: {message}");
        DispatcherQueue.TryEnqueue(() => SetOverlayText(message));
    }

    private async Task OpenSettingsAsync()
    {
        try
        {
            await _bridgeManager.StartAsync();
            Process.Start(new ProcessStartInfo
            {
                FileName = _settingsUri.ToString(),
                UseShellExecute = true
            });
        }
        catch (Exception error)
        {
            _logger.Error("Failed to open settings", error);
            SetOverlayText(error.Message);
        }
    }

    private async Task RestartBridgeAsync()
    {
        try
        {
            var wasVisible = IsWindowVisible(_windowHandle);
            var placementReady = ConfigureWindow(saveSelection: false);
            if (placementReady && wasVisible)
            {
                RevealConfiguredWindow();
            }
            SetOverlayText("Restarting native dashboard server...");
            _logger.Info("Restarting native dashboard server from tray menu.");
            await _bridgeManager.RestartAsync();
            _navigationFailures = 0;
            NavigateDashboard(forceReload: true);
        }
        catch (Exception error)
        {
            _logger.Error("Bridge restart failed", error);
            SetOverlayText(error.Message);
        }
    }

    private void OpenLogs()
    {
        try
        {
            var logDirectory = Path.GetDirectoryName(_logger.LogPath);
            if (string.IsNullOrWhiteSpace(logDirectory))
            {
                return;
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = logDirectory,
                UseShellExecute = true
            });
        }
        catch (Exception error)
        {
            _logger.Error("Failed to open the log folder", error);
            SetOverlayText(error.Message);
        }
    }

    private async Task ResetDashboardStateAsync()
    {
        try
        {
            _logger.Info("Resetting dashboard state from tray menu.");
            SetOverlayText("Resetting dashboard state...");

            if (DashboardView.CoreWebView2 is not null)
            {
                await DashboardView.CoreWebView2.ExecuteScriptAsync(
                    """
                    (() => {
                      try {
                        localStorage.removeItem("xeneon-dashboard-widget");
                        localStorage.removeItem("xeneon-dashboard-last-widget");
                        localStorage.removeItem("xeneon-dashboard-settings");
                      } catch {}
                      location.reload();
                    })();
                    """);
            }

            _navigationFailures = 0;
            NavigateDashboard(forceReload: true);
        }
        catch (Exception error)
        {
            _logger.Error("Failed to reset dashboard state", error);
            SetOverlayText(error.Message);
        }
    }

    private void ShowDisplayWindow()
    {
        ShowWindow(_windowHandle, SwHide);
        if (ConfigureWindow(saveSelection: false))
        {
            RevealConfiguredWindow();
        }
    }

    private void BeginDisplayMoveMode()
    {
        Interlocked.Increment(ref _lockedPresentationGeneration);
        ShowWindow(_windowHandle, SwHide);
        try
        {
            var displayCandidates = _bridgeManager
                .ListDisplayCandidates(ignoreSavedPreference: true)
                .Where(display => !display.IsPrimary)
                .ToList();
            if (displayCandidates.Count == 0)
            {
                EnterCompanionDisplayWaitingState(
                    _windowHandle,
                    "Connect or enable a non-primary companion display before moving Auxora.");
                ScheduleDisplayRecovery("move display requested without a companion display");
                return;
            }

            var pickerDisplay = displayCandidates.FirstOrDefault(display =>
                    display.IsPreferredDisplay(_configuredDisplayId))
                ?? _bridgeManager.SelectDisplayTarget(displayCandidates, saveSelection: false);
            _displayMoveMode = true;
            ApplyDisplaySelectionWindow(AppWindow, _windowHandle, pickerDisplay, displayCandidates);
            DisplayPickerStatus.Text = "Position is unlocked. Drag this window within a companion display if needed, then choose the companion below to lock Auxora there.";
            RevealConfiguredWindow();
            _logger.Info("Auxora display position unlocked for deliberate movement.");
        }
        catch (Exception error)
        {
            _logger.Error("Opening Auxora display move mode failed", error);
            _displayMoveMode = false;
            if (ConfigureWindow(saveSelection: false))
            {
                RevealConfiguredWindow();
            }
        }
    }

    private void RequestQuitFromTray()
    {
        if (!DispatcherQueue.TryEnqueue(QuitApplication))
        {
            QuitApplication();
        }
    }

    private void HandleRecoveryQuitRequested()
    {
        if (!DispatcherQueue.TryEnqueue(QuitApplication))
        {
            QuitApplication();
        }
    }

    private Task<ResetStepReceipt> ClearWebViewBrowsingDataAsync(CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<ResetStepReceipt>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!DispatcherQueue.TryEnqueue(async () =>
        {
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                var profile = DashboardView.CoreWebView2?.Profile;
                if (profile is null)
                {
                    completion.TrySetResult(new ResetStepReceipt
                    {
                        Id = "webview-data",
                        Label = "WebView browsing data",
                        Required = false,
                        Status = "unavailable",
                        Message = "The WebView profile was not initialized, so no profile deletion was claimed."
                    });
                    return;
                }

                await profile.ClearBrowsingDataAsync();
                completion.TrySetResult(new ResetStepReceipt
                {
                    Id = "webview-data",
                    Label = "WebView browsing data",
                    Required = false,
                    Status = "cleared",
                    Message = "Cleared the active WebView profile browsing data."
                });
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                completion.TrySetCanceled(cancellationToken);
            }
            catch (Exception error)
            {
                completion.TrySetException(error);
            }
        }))
        {
            completion.TrySetException(new InvalidOperationException("The WebView dispatcher is unavailable."));
        }

        return completion.Task;
    }

    private void StartShowDisplaySignalListener()
    {
        if (_showDisplayEvent is not null)
        {
            return;
        }

        _showDisplayEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowDisplayEventName);
        _showDisplayWaitHandle = ThreadPool.RegisterWaitForSingleObject(
            _showDisplayEvent,
            (_, timedOut) =>
            {
                if (!timedOut && !_disposed)
                {
                    DispatcherQueue.TryEnqueue(ShowDisplayWindow);
                }
            },
            null,
            Timeout.Infinite,
            executeOnlyOnce: false);
    }

    private void QuitApplication()
    {
        if (Interlocked.Exchange(ref _quitRequested, 1) == 1)
        {
            return;
        }

        _logger.Info("Quit requested from tray menu.");
        ScheduleForceExitIfShutdownStalls();

        try
        {
            _trayIcon?.Dispose();
            _trayIcon = null;
        }
        catch (Exception error)
        {
            _logger.Warn($"Tray icon cleanup failed during quit: {error.Message}");
        }

        try
        {
            Close();
        }
        catch (Exception error)
        {
            _logger.Error("Window close failed during quit.", error);
        }

        try
        {
            Application.Current.Exit();
        }
        catch (Exception error)
        {
            _logger.Error("Application exit failed during quit.", error);
            Environment.Exit(0);
        }
    }

    private void HandleClosed(object sender, WindowEventArgs args)
    {
        _logger.Info("Window closing.");
        DisposeResources();
    }

    private void HandleAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (System.Threading.Volatile.Read(ref _quitRequested) == 1)
        {
            return;
        }

        args.Cancel = true;
        if (_displayMoveMode)
        {
            _logger.Info("Display move mode closed; restoring Auxora to its sticky companion placement.");
            _displayMoveMode = false;
            ShowWindow(_windowHandle, SwHide);
            if (ConfigureWindow(saveSelection: false))
            {
                RevealConfiguredWindow();
            }
            return;
        }

        _logger.Info("Window close button pressed; hiding the dashboard window and keeping the local bridge running.");
        ShowWindow(WindowNative.GetWindowHandle(this), SwHide);
    }

    private void HandleAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (!_waitingForEdgeDisplay
            || _disposed
            || (!args.DidPositionChange && !args.DidSizeChange)
            || Interlocked.Exchange(ref _displayMoveConstraintQueued, 1) == 1)
        {
            return;
        }

        if (!DispatcherQueue.TryEnqueue(() =>
        {
            try
            {
                ConstrainDisplayPickerToCompanion();
            }
            finally
            {
                Interlocked.Exchange(ref _displayMoveConstraintQueued, 0);
            }
        }))
        {
            Interlocked.Exchange(ref _displayMoveConstraintQueued, 0);
        }
    }

    private void ConstrainDisplayPickerToCompanion()
    {
        if (!_waitingForEdgeDisplay || _disposed)
        {
            return;
        }

        var companions = _bridgeManager
            .ListDisplayCandidates(ignoreSavedPreference: true)
            .Where(display => !display.IsPrimary)
            .ToList();
        if (companions.Count == 0)
        {
            EnterCompanionDisplayWaitingState(
                _windowHandle,
                "Auxora stopped moving because no non-primary companion display is active.");
            ScheduleDisplayRecovery("display move lost all companion displays");
            return;
        }

        var position = AppWindow.Position;
        var size = AppWindow.Size;
        var requestedLeft = position.X;
        var requestedTop = position.Y;
        var requestedRight = position.X + size.Width;
        var requestedBottom = position.Y + size.Height;
        var target = companions
            .OrderByDescending(display => IntersectionArea(
                requestedLeft,
                requestedTop,
                requestedRight,
                requestedBottom,
                display.Bounds.Left,
                display.Bounds.Top,
                display.Bounds.Right,
                display.Bounds.Bottom))
            .ThenByDescending(display => display.IsPreferredDisplay(_configuredDisplayId))
            .First();

        var width = Math.Min(Math.Max(320, size.Width), target.Bounds.Width);
        var height = Math.Min(Math.Max(240, size.Height), target.Bounds.Height);
        var x = Math.Clamp(position.X, target.Bounds.Left, target.Bounds.Right - width);
        var y = Math.Clamp(position.Y, target.Bounds.Top, target.Bounds.Bottom - height);
        _configuredDisplayId = target.StableId;

        if (x != position.X || y != position.Y || width != size.Width || height != size.Height)
        {
            AppWindow.MoveAndResize(new RectInt32(x, y, width, height));
        }
    }

    private static long IntersectionArea(
        int firstLeft,
        int firstTop,
        int firstRight,
        int firstBottom,
        int secondLeft,
        int secondTop,
        int secondRight,
        int secondBottom)
    {
        var width = Math.Max(0, Math.Min(firstRight, secondRight) - Math.Max(firstLeft, secondLeft));
        var height = Math.Max(0, Math.Min(firstBottom, secondBottom) - Math.Max(firstTop, secondTop));
        return (long)width * height;
    }

    private void SetOverlayText(string message)
    {
        OverlayPanel.Visibility = Visibility.Visible;
        StatusText.Text = message;
    }

    private void EnsureDisplayWindowStaysOffTaskbar(IntPtr windowHandle)
    {
        if (windowHandle == IntPtr.Zero)
        {
            return;
        }

        var currentStyle = GetWindowLongPtr(windowHandle, GwlExStyle).ToInt64();
        var nextStyle = (currentStyle | WsExToolWindow | WsExNoActivate) & ~WsExAppWindow;

        var styleChanged = nextStyle != currentStyle;
        if (styleChanged)
        {
            SetWindowLongPtr(windowHandle, GwlExStyle, new IntPtr(nextStyle));
            ShowWindow(windowHandle, SwHide);
        }

        KeepDisplayWindowOnTop(windowHandle, includeFrameChanged: styleChanged, showWindow: false);
        _taskbarStyleApplied = true;
        if (styleChanged || !_taskbarStyleApplied)
        {
            _logger.Info("Applied no-activate topmost tool-window style so the Auxora display stays visible, stays off the taskbar, and does not steal audio focus.");
        }
    }

    private void RestoreDisplayWindowToTaskbar(IntPtr windowHandle)
    {
        if (windowHandle == IntPtr.Zero)
        {
            return;
        }

        Interlocked.Increment(ref _lockedPresentationGeneration);

        var currentStyle = GetWindowLongPtr(windowHandle, GwlExStyle).ToInt64();
        var nextStyle = (currentStyle | WsExAppWindow) & ~WsExToolWindow & ~WsExNoActivate;
        var styleChanged = nextStyle != currentStyle;
        if (styleChanged)
        {
            SetWindowLongPtr(windowHandle, GwlExStyle, new IntPtr(nextStyle));
        }

        var flags = SwpNoMove | SwpNoSize | SwpNoActivate | (styleChanged ? SwpFrameChanged : 0u);

        SetWindowPos(
            windowHandle,
            HwndNoTopmost,
            0,
            0,
            0,
            0,
            flags);
        _taskbarStyleApplied = false;
        _logger.Info("Restored normal taskbar-visible window style while selecting an Auxora display.");
    }

    private void ShowWindowNoActivate()
    {
        var windowHandle = _windowHandle;
        if (windowHandle == IntPtr.Zero)
        {
            return;
        }

        if (_companionDisplayUnavailable)
        {
            ShowWindow(windowHandle, SwHide);
            return;
        }

        if (_waitingForEdgeDisplay)
        {
            ShowWindow(windowHandle, SwShowNoActivate);
            return;
        }

        KeepDisplayWindowOnTop(windowHandle);
        ShowWindow(windowHandle, SwShowNoActivate);
    }

    private bool RevealConfiguredWindow()
    {
        if (_companionDisplayUnavailable || string.IsNullOrWhiteSpace(_configuredDisplayId))
        {
            ShowWindow(_windowHandle, SwHide);
            return false;
        }

        try
        {
            // Resolve against the current topology immediately before showing so
            // a former companion that was promoted to primary can never be used.
            var currentTarget = DisplayManager.ResolveCompanionDisplay(_configuredDisplayId);
            if (currentTarget.IsPrimary)
            {
                throw new InvalidOperationException("The configured target is now the Windows primary display.");
            }

            _configuredDisplayId = currentTarget.StableId;
            AppWindow.SetPresenter(AppWindowPresenterKind.Overlapped);
            if (AppWindow.Presenter is OverlappedPresenter presenter)
            {
                presenter.SetBorderAndTitleBar(_waitingForEdgeDisplay, _waitingForEdgeDisplay);
                presenter.IsResizable = _waitingForEdgeDisplay;
                presenter.IsMaximizable = _waitingForEdgeDisplay;
                presenter.IsMinimizable = _waitingForEdgeDisplay;
            }

            AppWindow.MoveAndResize(_waitingForEdgeDisplay
                ? BuildDisplaySelectionBounds(currentTarget)
                : new RectInt32(
                    currentTarget.Bounds.X,
                    currentTarget.Bounds.Y,
                    currentTarget.Bounds.Width,
                    currentTarget.Bounds.Height));

            if (!_waitingForEdgeDisplay)
            {
                AppWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
                // FullScreen presentation can rewrite extended window styles. Reapply
                // the tool-window/topmost policy afterwards so the companion taskbar
                // cannot cover the bottom of Auxora after a mode or topology change.
                EnsureDisplayWindowStaysOffTaskbar(_windowHandle);
            }
        }
        catch (Exception error)
        {
            _logger.Warn($"Pre-reveal companion-display validation failed: {error.Message}");
            EnterCompanionDisplayWaitingState(_windowHandle, "Auxora is waiting for a verified companion display.");
            ScheduleDisplayRecovery("pre-reveal companion validation failed");
            return false;
        }

        ShowWindowNoActivate();
        _windowHasBeenShown = true;
        BeginDashboardStartupIfReady();
        if (!_waitingForEdgeDisplay)
        {
            ScheduleLockedPresentationReassert();
        }
        return true;
    }

    private void ScheduleLockedPresentationReassert()
    {
        var generation = Interlocked.Increment(ref _lockedPresentationGeneration);
        _ = ReassertLockedPresentationAsync(generation);
    }

    private async Task ReassertLockedPresentationAsync(int generation)
    {
        foreach (var delay in new[] { TimeSpan.FromMilliseconds(120), TimeSpan.FromMilliseconds(850) })
        {
            await Task.Delay(delay);
            if (_disposed || generation != Volatile.Read(ref _lockedPresentationGeneration))
            {
                return;
            }

            DispatcherQueue.TryEnqueue(() =>
            {
                if (_disposed
                    || generation != Volatile.Read(ref _lockedPresentationGeneration)
                    || _displayMoveMode
                    || _waitingForEdgeDisplay
                    || _companionDisplayUnavailable)
                {
                    return;
                }

                // Windows can raise the companion taskbar after a fullscreen or
                // move-mode transition. Reassert z-order only after that transition
                // settles; do not activate the window or steal keyboard/audio focus.
                KeepDisplayWindowOnTop(_windowHandle);
            });
        }
    }

    private static void KeepDisplayWindowOnTop(
        IntPtr windowHandle,
        bool includeFrameChanged = false,
        bool showWindow = true)
    {
        var flags = SwpNoMove | SwpNoSize | SwpNoActivate;
        if (showWindow)
        {
            flags |= SwpShowWindow;
        }
        if (includeFrameChanged)
        {
            flags |= SwpFrameChanged;
        }

        SetWindowPos(
            windowHandle,
            HwndTopmost,
            0,
            0,
            0,
            0,
            flags);
    }

    private void ScheduleForceExitIfShutdownStalls()
    {
        _ = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromSeconds(4));
            _logger.Warn("Quit did not complete within 4 seconds. Forcing process exit.");
            Environment.Exit(0);
        });
    }

    private void DisposeResources()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        DashboardView.NavigationCompleted -= HandleNavigationCompleted;
        DashboardView.NavigationStarting -= HandleNavigationStarting;
        SystemEvents.DisplaySettingsChanged -= HandleDisplaySettingsChanged;
        _bridgeManager.DisplayPreferenceChanged -= HandleDisplayPreferenceChanged;
        AppWindow.Closing -= HandleAppWindowClosing;
        AppWindow.Changed -= HandleAppWindowChanged;
        if (DashboardView.CoreWebView2 is not null && _webViewDiagnosticsAttached)
        {
            DashboardView.CoreWebView2.WebMessageReceived -= HandleWebMessageReceived;
            DashboardView.CoreWebView2.ProcessFailed -= HandleProcessFailed;
        }
        _bridgeManager.StatusChanged -= HandleBridgeStatusChanged;
        _bridgeManager.BridgeReady -= HandleBridgeReady;
        _bridgeManager.BridgeStopped -= HandleBridgeStopped;
        _bridgeManager.QuitRequested -= HandleRecoveryQuitRequested;
        _showDisplayWaitHandle?.Unregister(null);
        _showDisplayEvent?.Dispose();
        _displayRecoveryCancellation?.Cancel();
        _displayRecoveryCancellation?.Dispose();
        _trayIcon?.Dispose();
        _bridgeManager.Dispose();
        _logger.Info("Resources disposed. Exiting.");
    }

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    private static extern int GetWindowLong32(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr newLong);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern int SetWindowLong32(IntPtr hWnd, int index, int newLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    private static IntPtr GetWindowLongPtr(IntPtr hWnd, int index)
    {
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(hWnd, index)
            : new IntPtr(GetWindowLong32(hWnd, index));
    }

    private static IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr newLong)
    {
        return IntPtr.Size == 8
            ? SetWindowLongPtr64(hWnd, index, newLong)
            : new IntPtr(SetWindowLong32(hWnd, index, unchecked((int)newLong.ToInt64())));
    }
}
