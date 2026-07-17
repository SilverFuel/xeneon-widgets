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
    private const int SwShow = 5;
    private const int SwShowNoActivate = 4;
    private const int WaitingWindowWidth = 1120;
    private const int WaitingWindowHeight = 720;
    private static readonly TimeSpan DisplayRecoveryWindow = TimeSpan.FromSeconds(30);
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
    private bool _taskbarStyleApplied;
    private bool _waitingForEdgeDisplay;
    private int _quitRequested;
    private int _navigationFailures;
    private int _webViewRecoveryScheduled;
    private int _displayRecoveryScheduled;
    private EventWaitHandle? _showDisplayEvent;
    private RegisteredWaitHandle? _showDisplayWaitHandle;
    private CancellationTokenSource? _displayRecoveryCancellation;

    public MainWindow()
    {
        InitializeComponent();

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

        AppWindow.Closing += HandleAppWindowClosing;
        Activated += HandleActivated;
        Closed += HandleClosed;
        DashboardView.NavigationCompleted += HandleNavigationCompleted;
        SystemEvents.DisplaySettingsChanged += HandleDisplaySettingsChanged;
        StartShowDisplaySignalListener();
    }

    private async void HandleActivated(object sender, WindowActivatedEventArgs args)
    {
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        _trayIcon ??= new TrayIcon(
            WindowNative.GetWindowHandle(this),
            onOpenSettings: () => DispatcherQueue.TryEnqueue(() => _ = OpenSettingsAsync()),
            onRestartBridge: () => DispatcherQueue.TryEnqueue(() => _ = RestartBridgeAsync()),
            onShowDisplay: () => DispatcherQueue.TryEnqueue(ShowDisplayWindow),
            onOpenLogs: () => DispatcherQueue.TryEnqueue(OpenLogs),
            onResetDashboard: () => DispatcherQueue.TryEnqueue(() => _ = ResetDashboardStateAsync()),
            onQuit: RequestQuitFromTray,
            logger: _logger);
        ConfigureWindow(saveSelection: false);
        ScheduleDisplayRecovery("startup display backoff");
        await InitializeHostAsync();
    }

    private void ConfigureWindow(bool saveSelection)
    {
        var windowHandle = WindowNative.GetWindowHandle(this);
        var safeMode = Program.LaunchOptions.SafeMode;
        var displayCandidates = _bridgeManager.ListDisplayCandidates(ignoreSavedPreference: safeMode);
        if (displayCandidates.Count == 0)
        {
            throw new InvalidOperationException("No displays were detected.");
        }

        var needsDisplaySelection = !safeMode && displayCandidates.Count > 1 && displayCandidates.All(display => !display.IsPreferred);
        var targetDisplay = _bridgeManager.SelectDisplayTarget(
            displayCandidates,
            saveSelection: saveSelection && !safeMode,
            preferPrimary: safeMode);
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
            var rescueDisplay = displayCandidates.FirstOrDefault(display => display.IsPrimary) ?? targetDisplay;
            ApplyDisplaySelectionWindow(appWindow, windowHandle, rescueDisplay, displayCandidates);
            return;
        }

        appWindow.MoveAndResize(new RectInt32(
            targetDisplay.Bounds.X,
            targetDisplay.Bounds.Y,
            targetDisplay.Bounds.Width,
            targetDisplay.Bounds.Height));
        EnsureDisplayWindowStaysOffTaskbar(windowHandle);
        _waitingForEdgeDisplay = false;
        DisplayPickerPanel.Visibility = Visibility.Collapsed;
        DashboardView.Visibility = Visibility.Visible;

        _logger.Info("Display candidates: " + string.Join(" | ", displayCandidates.Select(DescribeDisplayCandidate)));
        _logger.Info($"{(safeMode ? "Safe Mode: " : "")}Window positioned on {targetDisplay.Label} (score {targetDisplay.Score}).");
        if (!_dashboardLoaded)
        {
            SetOverlayText(safeMode
                ? $"Safe Mode: launching on primary display ({targetDisplay.Label})."
                : $"Launching on {targetDisplay.Label}.");
        }
        else
        {
            OverlayPanel.Visibility = Visibility.Collapsed;
        }
    }

    private void ApplyDisplaySelectionWindow(
        AppWindow appWindow,
        IntPtr windowHandle,
        DisplayTarget rescueDisplay,
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

        var availableWidth = Math.Max(320, rescueDisplay.Bounds.Width - 64);
        var availableHeight = Math.Max(240, rescueDisplay.Bounds.Height - 32);
        var width = Math.Min(WaitingWindowWidth, availableWidth);
        var height = Math.Min(WaitingWindowHeight, availableHeight);
        var x = rescueDisplay.Bounds.X + Math.Max(0, (rescueDisplay.Bounds.Width - width) / 2);
        var y = rescueDisplay.Bounds.Y + Math.Max(0, (rescueDisplay.Bounds.Height - height) / 2);

        appWindow.MoveAndResize(new RectInt32(x, y, width, height));
        ShowWindow(windowHandle, SwShow);
        _waitingForEdgeDisplay = true;

        _logger.Info("Display candidates: " + string.Join(" | ", displayCandidates.Select(DescribeDisplayCandidate)));
        _logger.Info($"Auxora needs a preferred display; showing display selection on {rescueDisplay.Label}.");
        ShowDisplayPicker(displayCandidates);
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
            _bridgeManager.SetDisplayPreference(displayId);
        }
        catch (Exception error)
        {
            _logger.Error("Native display selection failed", error);
            DisplayPickerStatus.Text = "That display is no longer available. Refresh the list and try again.";
            DisplayPickerStatus.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 255, 165, 120));
            foreach (var child in DisplayPickerList.Children.OfType<Button>())
            {
                child.IsEnabled = true;
            }
        }
    }

    private void HandleRefreshDisplays(object sender, RoutedEventArgs args)
    {
        try
        {
            ShowDisplayPicker(_bridgeManager.ListDisplayCandidates(ignoreSavedPreference: true));
        }
        catch (Exception error)
        {
            _logger.Error("Display picker refresh failed", error);
            DisplayPickerStatus.Text = "Windows could not refresh the display list. Check the connection and try again.";
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
        _logger.Info("Display topology changed; scheduling Auxora window recovery.");
        ScheduleDisplayRecovery("display topology changed");
    }

    private void HandleDisplayPreferenceChanged()
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            ConfigureWindow(saveSelection: false);
            ShowWindowNoActivate();
            _logger.Info("Auxora moved to the newly selected display.");
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
                var startedAt = DateTimeOffset.UtcNow;
                foreach (var delay in DisplayRecoveryDelays)
                {
                    await Task.Delay(delay, token);
                    if (_disposed || token.IsCancellationRequested)
                    {
                        return;
                    }

                    var recovered = await TryRecoverDisplayPlacementAsync(reason, token);
                    if (recovered || DateTimeOffset.UtcNow - startedAt > DisplayRecoveryWindow)
                    {
                        return;
                    }
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
                var diagnostics = DisplayManager.BuildDiagnostics();
                ConfigureWindow(saveSelection: false);
                ShowWindowNoActivate();
                var recovered = diagnostics.EdgeCandidateCount > 0;
                _logger.Info($"Display recovery pass after {reason}: edgeCandidates={diagnostics.EdgeCandidateCount}; recovered={recovered}.");
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

            SetOverlayText("Initializing WebView2...");
            _logger.Info("Initializing WebView2.");
            await EnsureWebViewReadyAsync();

            _logger.Info("Navigating to dashboard.");
            NavigateDashboard(forceReload: false);
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

    private void HandleNavigationCompleted(WebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.IsSuccess)
        {
            _navigationFailures = 0;
            _dashboardLoaded = true;
            if (_waitingForEdgeDisplay)
            {
                ShowDisplayPicker(_bridgeManager.ListDisplayCandidates(ignoreSavedPreference: true));
            }
            else
            {
                OverlayPanel.Visibility = Visibility.Collapsed;
            }
            _logger.Info("Dashboard loaded successfully.");
            return;
        }

        _navigationFailures++;
        _logger.Warn($"Dashboard navigation failed: {args.WebErrorStatus} (attempt {_navigationFailures}).");

        if (_navigationFailures <= 3)
        {
            SetOverlayText($"Dashboard loading failed ({args.WebErrorStatus}). Retrying...");
            _ = RetryNavigationAsync();
            return;
        }

        SetOverlayText($"Dashboard failed to load after {_navigationFailures} attempts.\n{args.WebErrorStatus}\n\nUse the tray icon to restart the server.");
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

    private async Task RetryNavigationAsync()
    {
        await Task.Delay(2000);

        if (_disposed)
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
        _logger.Info("Native dashboard server ready.");
        DispatcherQueue.TryEnqueue(async () =>
        {
            try
            {
                await EnsureWebViewReadyAsync();
                _navigationFailures = 0;
                NavigateDashboard(forceReload: true);
            }
            catch (Exception error)
            {
                _logger.Error("Failed to load dashboard after bridge ready", error);
                SetOverlayText(_webViewInitializationFailed ? BuildWebView2HelpText() : error.Message);
            }
        });
    }

    private void HandleBridgeStopped(string message)
    {
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
        ConfigureWindow(saveSelection: false);
        ShowWindowNoActivate();
    }

    private void RequestQuitFromTray()
    {
        if (!DispatcherQueue.TryEnqueue(QuitApplication))
        {
            QuitApplication();
        }
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
        _logger.Info("Window close button pressed; hiding the dashboard window and keeping the local bridge running.");
        ShowWindow(WindowNative.GetWindowHandle(this), SwHide);
    }

    private void SetOverlayText(string message)
    {
        OverlayPanel.Visibility = Visibility.Visible;
        StatusText.Text = message;
    }

    private void EnsureDisplayWindowStaysOffTaskbar(IntPtr windowHandle)
    {
        if (windowHandle == IntPtr.Zero || _taskbarStyleApplied)
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

        KeepDisplayWindowOnTop(windowHandle, includeFrameChanged: styleChanged);
        ShowWindow(windowHandle, SwShowNoActivate);
        _taskbarStyleApplied = true;
        _logger.Info("Applied no-activate topmost tool-window style so the Auxora display stays visible, stays off the taskbar, and does not steal audio focus.");
    }

    private void RestoreDisplayWindowToTaskbar(IntPtr windowHandle)
    {
        if (windowHandle == IntPtr.Zero)
        {
            return;
        }

        var currentStyle = GetWindowLongPtr(windowHandle, GwlExStyle).ToInt64();
        var nextStyle = (currentStyle | WsExAppWindow) & ~WsExToolWindow & ~WsExNoActivate;
        var styleChanged = nextStyle != currentStyle;
        if (styleChanged)
        {
            SetWindowLongPtr(windowHandle, GwlExStyle, new IntPtr(nextStyle));
        }

        SetWindowPos(
            windowHandle,
            HwndNoTopmost,
            0,
            0,
            0,
            0,
            SwpNoMove | SwpNoSize | SwpShowWindow | (styleChanged ? SwpFrameChanged : 0u));
        _taskbarStyleApplied = false;
        _logger.Info("Restored normal taskbar-visible window style while selecting an Auxora display.");
    }

    private void ShowWindowNoActivate()
    {
        var windowHandle = WindowNative.GetWindowHandle(this);
        if (windowHandle == IntPtr.Zero)
        {
            return;
        }

        if (_waitingForEdgeDisplay)
        {
            ShowWindow(windowHandle, SwShow);
            return;
        }

        KeepDisplayWindowOnTop(windowHandle);
        ShowWindow(windowHandle, SwShowNoActivate);
    }

    private static void KeepDisplayWindowOnTop(IntPtr windowHandle, bool includeFrameChanged = false)
    {
        var flags = SwpNoMove | SwpNoSize | SwpNoActivate | SwpShowWindow;
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
        SystemEvents.DisplaySettingsChanged -= HandleDisplaySettingsChanged;
        _bridgeManager.DisplayPreferenceChanged -= HandleDisplayPreferenceChanged;
        AppWindow.Closing -= HandleAppWindowClosing;
        if (DashboardView.CoreWebView2 is not null && _webViewDiagnosticsAttached)
        {
            DashboardView.CoreWebView2.WebMessageReceived -= HandleWebMessageReceived;
            DashboardView.CoreWebView2.ProcessFailed -= HandleProcessFailed;
        }
        _bridgeManager.StatusChanged -= HandleBridgeStatusChanged;
        _bridgeManager.BridgeReady -= HandleBridgeReady;
        _bridgeManager.BridgeStopped -= HandleBridgeStopped;
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
