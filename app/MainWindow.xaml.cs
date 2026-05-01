using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
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
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpFrameChanged = 0x0020;
    private const int SwHide = 0;
    private const int SwShowNoActivate = 4;

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
    private bool _taskbarStyleApplied;
    private int _quitRequested;
    private int _navigationFailures;
    private EventWaitHandle? _showDisplayEvent;
    private RegisteredWaitHandle? _showDisplayWaitHandle;

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

        Activated += HandleActivated;
        Closed += HandleClosed;
        DashboardView.NavigationCompleted += HandleNavigationCompleted;
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
        ConfigureWindow();
        await InitializeHostAsync();
    }

    private void ConfigureWindow()
    {
        var windowHandle = WindowNative.GetWindowHandle(this);
        var targetDisplay = DisplayManager.FindBestDisplay();
        var appWindow = AppWindow;

        appWindow.SetPresenter(AppWindowPresenterKind.Overlapped);
        if (appWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.SetBorderAndTitleBar(false, false);
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
        }

        appWindow.MoveAndResize(new RectInt32(
            targetDisplay.Bounds.X,
            targetDisplay.Bounds.Y,
            targetDisplay.Bounds.Width,
            targetDisplay.Bounds.Height));
        EnsureDisplayWindowStaysOffTaskbar(windowHandle);

        _logger.Info($"Window positioned on {targetDisplay.Label} (score {targetDisplay.Score}).");
        SetOverlayText($"Launching on {targetDisplay.Label}.");
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
            SetOverlayText("Loading dashboard...");
            DashboardView.Source = _dashboardUri;
            return;
        }

        if (forceReload)
        {
            SetOverlayText("Reloading dashboard...");
            DashboardView.Reload();
        }
    }

    private void HandleNavigationCompleted(WebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.IsSuccess)
        {
            _navigationFailures = 0;
            OverlayPanel.Visibility = Visibility.Collapsed;
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
        ConfigureWindow();
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

        if (nextStyle == currentStyle)
        {
            _taskbarStyleApplied = true;
            return;
        }

        SetWindowLongPtr(windowHandle, GwlExStyle, new IntPtr(nextStyle));
        SetWindowPos(
            windowHandle,
            IntPtr.Zero,
            0,
            0,
            0,
            0,
            SwpNoMove | SwpNoSize | SwpNoZOrder | SwpNoActivate | SwpFrameChanged);
        ShowWindow(windowHandle, SwHide);
        ShowWindow(windowHandle, SwShowNoActivate);
        _taskbarStyleApplied = true;
        _logger.Info("Applied no-activate tool-window style so the EDGE display stays off the taskbar and does not steal audio focus.");
    }

    private void ShowWindowNoActivate()
    {
        var windowHandle = WindowNative.GetWindowHandle(this);
        if (windowHandle == IntPtr.Zero)
        {
            return;
        }

        SetWindowPos(
            windowHandle,
            IntPtr.Zero,
            0,
            0,
            0,
            0,
            SwpNoMove | SwpNoSize | SwpNoZOrder | SwpNoActivate);
        ShowWindow(windowHandle, SwShowNoActivate);
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
