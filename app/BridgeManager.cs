using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace XenonEdgeHost;

public sealed class BridgeManager : IDisposable
{
    private const string DashboardAssetRevision = "20260516-02";
    private const int MaxJsonBodyBytes = 256 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
    private static readonly Regex WindowsUserPathPattern = new(@"[A-Za-z]:\\Users\\[^\\\s""]+", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex MacUserPathPattern = new(@"/Users/[^/\s""]+", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex EmailPattern = new(@"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PrivateIpPattern = new(@"\b(?:(?:10)\.(?:\d{1,3}\.){2}\d{1,3}|(?:172)\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|(?:192\.168)\.\d{1,3}\.\d{1,3})\b", RegexOptions.Compiled);
    private static readonly Regex SensitiveQueryPattern = new(@"(?<name>(?:api[_-]?key|appid|token|secret|password|pass|sig|signature|auth|key))=[^&\s""]+", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly SemaphoreSlim _lifecycleLock = new(1, 1);
    private readonly HostLogger _logger = App.Logger;
    private readonly ConfigStore _configStore;
    private readonly EmbeddedAssetProvider _assetProvider;
    private readonly SystemMetricsService _systemMetrics;
    private readonly GpuPowerMonitorService _gpuPowerMonitor;
    private readonly NetworkMetricsService _networkMetrics;
    private readonly AudioService _audioService;
    private readonly WeatherService _weatherService;
    private readonly CalendarService _calendarService;
    private readonly HueService _hueService;
    private readonly UniFiService _uniFiService;
    private readonly ReleaseService _releaseService;
    private readonly MediaService _mediaService;
    private readonly LauncherService _launcherService;
    private readonly SteamService _steamService;
    private readonly GameActivityService _gameActivityService;
    private readonly ProvisioningService _provisioningService;
    private readonly SystemActionsService _systemActionsService;
    private readonly ClipboardHistoryService _clipboardHistoryService;
    private readonly HttpClient _weatherHttpClient;
    private readonly HashSet<string> _allowedOrigins;
    private HttpListener? _listener;
    private CancellationTokenSource? _serverCancellation;
    private Task? _serverTask;
    private bool _disposed;

    public BridgeManager()
    {
        _configStore = new ConfigStore(_logger);
        _assetProvider = new EmbeddedAssetProvider();
        _systemMetrics = new SystemMetricsService(_logger);
        _gpuPowerMonitor = new GpuPowerMonitorService(_logger);
        _networkMetrics = new NetworkMetricsService(_logger);
        _audioService = new AudioService(_logger);
        _weatherHttpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(10)
        };
        _weatherService = new WeatherService(_weatherHttpClient);
        _calendarService = new CalendarService(_weatherHttpClient, _logger);
        _hueService = new HueService(_configStore, _logger);
        _uniFiService = new UniFiService(_configStore, _logger);
        _releaseService = new ReleaseService(_weatherHttpClient);
        _mediaService = new MediaService(_logger);
        _launcherService = new LauncherService();
        _steamService = new SteamService(_logger);
        _gameActivityService = new GameActivityService(_steamService, _launcherService, _configStore, _logger);
        _provisioningService = new ProvisioningService(_configStore, _steamService, _logger);
        _systemActionsService = new SystemActionsService(_logger);
        _clipboardHistoryService = new ClipboardHistoryService(_logger);

        var baseUri = BuildBaseUri(_configStore.Current.Port);
        _allowedOrigins = BuildAllowedOrigins(_configStore.Current.Port);
        DashboardUri = new Uri(baseUri, $"dashboard.html?v={DashboardAssetRevision}");
        SettingsUri = new Uri(baseUri, $"dashboard.html?advanced=1&v={DashboardAssetRevision}");
        HealthUri = new Uri(baseUri, "api/health");
    }

    public Uri DashboardUri { get; }

    public Uri SettingsUri { get; }

    public Uri HealthUri { get; }

    public event Action<string>? StatusChanged;

    public event Action? BridgeReady;

    public event Action<string>? BridgeStopped;

    public List<DisplayTarget> ListDisplayCandidates(bool ignoreSavedPreference = false)
    {
        var config = _configStore.Snapshot();
        return DisplayManager.ListDisplays(ignoreSavedPreference ? null : config.Dashboard.PreferredDisplayId);
    }

    public DisplayTarget SelectDisplayTarget(
        IReadOnlyList<DisplayTarget>? candidates = null,
        bool saveSelection = true,
        bool preferPrimary = false)
    {
        var config = _configStore.Snapshot();
        var displayCandidates = candidates?.Count > 0
            ? candidates.ToList()
            : DisplayManager.ListDisplays(config.Dashboard.PreferredDisplayId);

        if (displayCandidates.Count == 0)
        {
            throw new InvalidOperationException("No displays were detected.");
        }

        var selected = preferPrimary
            ? displayCandidates.FirstOrDefault(display => display.IsPrimary) ?? displayCandidates[0]
            : displayCandidates[0];
        if (!saveSelection)
        {
            return selected;
        }

        _configStore.Update(current =>
        {
            current.Dashboard.PreferredDisplayId = selected.StableId;
            current.Dashboard.PreferredDisplayDeviceName = selected.DeviceName;
            current.Dashboard.DisplaySelectedAt = DateTime.UtcNow.ToString("O");
            current.Dashboard.LastKnownGoodVersion = typeof(BridgeManager).Assembly.GetName().Version?.ToString() ?? "";
            current.Dashboard.LastKnownGoodPath = Environment.ProcessPath ?? "";
            return current;
        });

        return selected;
    }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycleLock.WaitAsync(cancellationToken);
        try
        {
            StartCore();
        }
        finally
        {
            _lifecycleLock.Release();
        }
    }

    public async Task RestartAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycleLock.WaitAsync(cancellationToken);
        try
        {
            ThrowIfDisposed();
            RaiseStatus("Restarting native dashboard server...");
            await StopCoreAsync();
            cancellationToken.ThrowIfCancellationRequested();
            StartCore();
        }
        finally
        {
            _lifecycleLock.Release();
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        _lifecycleLock.Wait();
        try
        {
            StopCoreAsync().GetAwaiter().GetResult();
        }
        finally
        {
            _lifecycleLock.Release();
            _lifecycleLock.Dispose();
            _systemMetrics.Dispose();
            _gpuPowerMonitor.Dispose();
            _networkMetrics.Dispose();
            _hueService.Dispose();
            _uniFiService.Dispose();
            _weatherHttpClient.Dispose();
        }
    }

    private async Task StopCoreAsync()
    {
        var listener = _listener;
        var cancellation = _serverCancellation;
        var serverTask = _serverTask;

        _listener = null;
        _serverCancellation = null;
        _serverTask = null;

        if (listener is null)
        {
            return;
        }

        try
        {
            cancellation?.Cancel();
            listener.Stop();
            listener.Close();
            if (serverTask is not null)
            {
                await serverTask;
            }
        }
        catch (Exception error)
        {
            _logger.Error("Error while stopping native dashboard server.", error);
        }

        BridgeStopped?.Invoke("Native dashboard server stopped.");
    }

    private void StartCore()
    {
        ThrowIfDisposed();

        if (_listener?.IsListening == true)
        {
            RaiseStatus("Connected to native dashboard server.");
            BridgeReady?.Invoke();
            return;
        }

        _systemMetrics.Start();
        _gpuPowerMonitor.Start();
        _networkMetrics.Start();
        _uniFiService.RefreshDiscoveryInBackground();

        var listener = new HttpListener();
        listener.Prefixes.Add(BuildBaseUri(_configStore.Current.Port).ToString());

        try
        {
            listener.Start();
        }
        catch (HttpListenerException error)
        {
            listener.Close();
            _logger.Error($"Failed to bind native dashboard server to port {_configStore.Current.Port}.", error);
            throw new InvalidOperationException(
                $"The native dashboard server could not bind to port {_configStore.Current.Port}. Stop any existing helper using that port and try again.",
                error);
        }

        _listener = listener;
        _serverCancellation = new CancellationTokenSource();
        _serverTask = RunServerAsync(listener, _serverCancellation.Token);

        _logger.Info($"Native dashboard server listening on {BuildBaseUri(_configStore.Current.Port)}");
        RaiseStatus("Native dashboard server ready.");
        BridgeReady?.Invoke();
        StartProvisioningInBackground();
    }

    private void StartProvisioningInBackground()
    {
        _ = Task.Run(() =>
        {
            try
            {
                _provisioningService.RunStartupProvisioning();
            }
            catch (Exception error)
            {
                _logger.Error("Automatic provisioning failed.", error);
            }
        });
    }

    private async Task RunServerAsync(HttpListener listener, CancellationToken cancellationToken)
    {
        try
        {
            while (listener.IsListening && !cancellationToken.IsCancellationRequested)
            {
                HttpListenerContext context;
                try
                {
                    context = await listener.GetContextAsync();
                }
                catch (HttpListenerException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }

                _ = Task.Run(() => HandleRequestAsync(context, cancellationToken), cancellationToken);
            }
        }
        catch (Exception error)
        {
            _logger.Error("Native dashboard server loop failed.", error);
            BridgeStopped?.Invoke("Native dashboard server stopped unexpectedly.");
        }
    }

    private async Task HandleRequestAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        var request = context.Request;
        var response = context.Response;
        var requestId = CreateRequestId();
        var startedAt = Stopwatch.GetTimestamp();
        var method = request.HttpMethod;
        var path = request.Url?.PathAndQuery ?? "/";

        try
        {
            response.Headers["X-Request-ID"] = requestId;
            path = request.Url?.AbsolutePath ?? "/";

            if (!TryAuthorizeOrigin(request, out var corsOrigin))
            {
                await WriteJsonAsync(response, 403, new { error = "Origin not allowed." }, cancellationToken);
                return;
            }

            ApplyCorsHeaders(response, corsOrigin);

            if (request.HttpMethod == "OPTIONS")
            {
                await WriteJsonAsync(response, 204, new { }, cancellationToken);
                return;
            }

            switch (path)
            {
                case "/favicon.ico":
                    await WriteJsonAsync(response, 204, new { }, cancellationToken);
                    return;
                case "/api/health":
                    await WriteJsonAsync(response, 200, await BuildHealthPayloadAsync(cancellationToken), cancellationToken);
                    return;
                case "/api/provisioning" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, _provisioningService.GetSnapshot(), cancellationToken);
                    return;
                case "/api/provisioning/run" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, _provisioningService.RunStartupProvisioning(forceLauncherScan: true), cancellationToken);
                    return;
                case "/api/provisioning/launchers/apply" when request.HttpMethod == "POST":
                    await HandleLauncherSuggestionApplyAsync(request, response, cancellationToken);
                    return;
                case "/api/repair/run" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, await RunAutoRepairAsync(cancellationToken), cancellationToken);
                    return;
                case "/api/display/diagnostics" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, BuildDisplayDiagnostics(), cancellationToken);
                    return;
                case "/api/display/preference" when request.HttpMethod == "POST":
                    await HandleDisplayPreferenceAsync(request, response, cancellationToken);
                    return;
                case "/api/config" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, BuildConfigSnapshot(), cancellationToken);
                    return;
                case "/api/config/dashboard" when request.HttpMethod == "POST":
                    await HandleDashboardConfigUpdateAsync(request, response, cancellationToken);
                    return;
                case "/api/config/reset" when request.HttpMethod == "POST":
                    await HandleConfigResetAsync(response, cancellationToken);
                    return;
                case "/api/support/bundle" when request.HttpMethod == "GET":
                    await HandleSupportBundleAsync(response, cancellationToken);
                    return;
                case "/api/releases/latest":
                    await WriteJsonAsync(response, 200, await _releaseService.GetLatestReleaseAsync(GetReleaseChannel(request), cancellationToken), cancellationToken);
                    return;
                case "/api/releases/rollback" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, BuildRollbackPayload(), cancellationToken);
                    return;
                case "/api/config/weather" when request.HttpMethod == "POST":
                    await HandleWeatherConfigUpdateAsync(request, response, cancellationToken);
                    return;
                case "/api/config/calendar" when request.HttpMethod == "POST":
                    await HandleCalendarConfigUpdateAsync(request, response, cancellationToken);
                    return;
                case "/api/launchers" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, _launcherService.GetSnapshot(_configStore.Snapshot()), cancellationToken);
                    return;
                case "/api/launchers" when request.HttpMethod == "POST":
                    await HandleLauncherConfigUpdateAsync(request, response, cancellationToken);
                    return;
                case "/api/launchers/launch" when request.HttpMethod == "POST":
                    await HandleLauncherLaunchAsync(request, response, cancellationToken);
                    return;
                case "/api/launchers/icon" when request.HttpMethod == "GET":
                    await HandleLauncherIconAsync(request, response, cancellationToken);
                    return;
                case "/api/steam/games" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, _steamService.GetSnapshot(IsTruthyQueryValue(request, "refresh")), cancellationToken);
                    return;
                case "/api/steam/games/launch" when request.HttpMethod == "POST":
                    await HandleSteamGameLaunchAsync(request, response, cancellationToken);
                    return;
                case "/api/steam/games/art" when request.HttpMethod == "GET":
                    await HandleSteamGameArtworkAsync(request, response, cancellationToken);
                    return;
                case "/api/game/activity" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, _gameActivityService.GetSnapshot(IsTruthyQueryValue(request, "refresh")), cancellationToken);
                    return;
                case "/api/game/activity/pin" when request.HttpMethod == "POST":
                    await HandleGameActivityPinAsync(request, response, cancellationToken);
                    return;
                case "/api/system":
                    await WriteJsonAsync(response, 200, _systemMetrics.GetSnapshot(), cancellationToken);
                    return;
                case "/api/gpu-power":
                    await WriteJsonAsync(response, 200, _gpuPowerMonitor.GetSnapshot(), cancellationToken);
                    return;
                case "/api/network":
                    await WriteJsonAsync(response, 200, _networkMetrics.GetSnapshot(), cancellationToken);
                    return;
                case "/api/unifi/network":
                    await WriteJsonAsync(response, 200, await _uniFiService.GetNetworkPayloadAsync(_networkMetrics.GetSnapshot(), cancellationToken), cancellationToken);
                    return;
                case "/api/unifi/network/link" when request.HttpMethod == "POST":
                    await HandleUniFiLinkAsync(request, response, cancellationToken);
                    return;
                case "/api/unifi/network/disconnect" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, _uniFiService.Disconnect(_networkMetrics.GetSnapshot()), cancellationToken);
                    return;
                case "/api/quick-actions" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, _systemActionsService.GetQuickActionsSnapshot(), cancellationToken);
                    return;
                case "/api/system-shortcuts" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, _systemActionsService.GetShortcutsSnapshot(), cancellationToken);
                    return;
                case "/api/system-shortcuts/brightness" when request.HttpMethod == "POST":
                    await HandleBrightnessUpdateAsync(request, response, cancellationToken);
                    return;
                case "/api/audio" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, await _audioService.GetSnapshotAsync(cancellationToken), cancellationToken);
                    return;
                case "/api/audio/default-device" when request.HttpMethod == "POST":
                    await HandleAudioDefaultDeviceAsync(request, response, cancellationToken);
                    return;
                case "/api/audio/master-volume" when request.HttpMethod == "POST":
                    await HandleAudioMasterVolumeAsync(request, response, cancellationToken);
                    return;
                case "/api/audio/master-mute" when request.HttpMethod == "POST":
                    await HandleAudioMasterMuteAsync(request, response, cancellationToken);
                    return;
                case "/api/audio/session-volume" when request.HttpMethod == "POST":
                    await HandleAudioSessionVolumeAsync(request, response, cancellationToken);
                    return;
                case "/api/audio/session-mute" when request.HttpMethod == "POST":
                    await HandleAudioSessionMuteAsync(request, response, cancellationToken);
                    return;
                case "/api/weather":
                    await HandleWeatherRequestAsync(request, response, cancellationToken);
                    return;
                case "/api/calendar":
                    await WriteJsonAsync(response, 200, await _calendarService.GetSnapshotAsync(_configStore.Snapshot(), cancellationToken), cancellationToken);
                    return;
                case "/api/media":
                    await WriteJsonAsync(response, 200, await _mediaService.GetSnapshotAsync(cancellationToken), cancellationToken);
                    return;
                case "/api/media/play" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, await _mediaService.ExecuteAsync("play", cancellationToken), cancellationToken);
                    return;
                case "/api/media/pause" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, await _mediaService.ExecuteAsync("pause", cancellationToken), cancellationToken);
                    return;
                case "/api/media/play-pause" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, await _mediaService.ExecuteAsync("play-pause", cancellationToken), cancellationToken);
                    return;
                case "/api/media/next" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, await _mediaService.ExecuteAsync("next", cancellationToken), cancellationToken);
                    return;
                case "/api/media/previous" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, await _mediaService.ExecuteAsync("previous", cancellationToken), cancellationToken);
                    return;
                case "/api/media/seek-back" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, await _mediaService.ExecuteAsync("seek-back", cancellationToken), cancellationToken);
                    return;
                case "/api/media/seek-forward" when request.HttpMethod == "POST":
                    await WriteJsonAsync(response, 200, await _mediaService.ExecuteAsync("seek-forward", cancellationToken), cancellationToken);
                    return;
                case "/api/hue" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, await _hueService.GetSnapshotAsync(_configStore.Snapshot(), cancellationToken), cancellationToken);
                    return;
                case "/api/hue/link" when request.HttpMethod == "POST":
                    await HandleHueLinkAsync(request, response, cancellationToken);
                    return;
                case "/api/clipboard" when request.HttpMethod == "GET":
                    await WriteJsonAsync(response, 200, await _clipboardHistoryService.GetSnapshotAsync(cancellationToken), cancellationToken);
                    return;
                case "/api/clipboard/copy" when request.HttpMethod == "POST":
                    await HandleClipboardCopyAsync(request, response, cancellationToken);
                    return;
                default:
                    if (await TryHandleQuickActionAsync(path, request, response, cancellationToken))
                    {
                        return;
                    }

                    if (await TryHandleSystemShortcutActionAsync(path, request, response, cancellationToken))
                    {
                        return;
                    }

                    if (await TryHandleHueActionAsync(path, request, response, cancellationToken))
                    {
                        return;
                    }

                    if (path.StartsWith("/api/audio/", StringComparison.OrdinalIgnoreCase)
                        || path.StartsWith("/api/hue/", StringComparison.OrdinalIgnoreCase)
                        || path.StartsWith("/api/media/", StringComparison.OrdinalIgnoreCase))
                    {
                        await WriteJsonAsync(response, 501, BuildUnsupportedFeaturePayload(
                            "unsupported",
                            "This native endpoint is not implemented yet."), cancellationToken);
                        return;
                    }

                    if (_assetProvider.TryGetAsset(path, out var asset))
                    {
                        await WriteAssetAsync(response, asset, cancellationToken);
                        return;
                    }

                    await WriteTextAsync(response, 404, "Not found", cancellationToken);
                    return;
            }
        }
        catch (RequestBodyTooLargeException error)
        {
            _logger.Warn(error.Message);
            try
            {
                await WriteJsonAsync(context.Response, 413, new { error = error.Message }, cancellationToken);
            }
            catch
            {
            }
        }
        catch (JsonException error)
        {
            _logger.Warn($"Invalid JSON request body: {error.Message}");
            try
            {
                await WriteJsonAsync(context.Response, 400, new { error = "Invalid JSON request body." }, cancellationToken);
            }
            catch
            {
            }
        }
        catch (Exception error)
        {
            _logger.Error("Failed to process request.", error);
            try
            {
                await WriteJsonAsync(context.Response, 500, new { error = error.Message }, cancellationToken);
            }
            catch
            {
            }
        }
        finally
        {
            LogRequestBoundary(requestId, method, path, response.StatusCode, Stopwatch.GetElapsedTime(startedAt));
        }
    }

    private async Task HandleDashboardConfigUpdateAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<DashboardConfigRequest>(request, cancellationToken);
        _configStore.Update(current =>
        {
            if (payload.OnboardingVersion is > 0)
            {
                current.Dashboard.OnboardingVersion = payload.OnboardingVersion.Value;
            }

            if (payload.OnboardingCompleted == true)
            {
                current.Dashboard.OnboardingCompleted = true;
                current.Dashboard.OnboardingCompletedAt = DateTime.UtcNow.ToString("O");
            }
            else if (payload.OnboardingCompleted == false)
            {
                current.Dashboard.OnboardingCompleted = false;
                current.Dashboard.OnboardingCompletedAt = "";
            }

            if (payload.LauncherReviewRequired.HasValue)
            {
                current.Dashboard.LauncherReviewRequired = payload.LauncherReviewRequired.Value;
            }

            if (payload.AutoApplyLauncherSuggestions.HasValue)
            {
                current.Dashboard.AutoApplyLauncherSuggestions = payload.AutoApplyLauncherSuggestions.Value;
            }

            if (payload.PreferredDisplayId is not null)
            {
                current.Dashboard.PreferredDisplayId = payload.PreferredDisplayId.Trim();
                current.Dashboard.DisplaySelectedAt = DateTime.UtcNow.ToString("O");
            }

            if (payload.PreferredDisplayDeviceName is not null)
            {
                current.Dashboard.PreferredDisplayDeviceName = payload.PreferredDisplayDeviceName.Trim();
            }

            if (payload.PerformanceBudget is not null)
            {
                current.Dashboard.PerformanceBudget = payload.PerformanceBudget.Trim();
            }

            if (payload.GameModeAutoTune.HasValue)
            {
                current.Dashboard.GameModeAutoTune = payload.GameModeAutoTune.Value;
            }

            if (payload.ThemeReadability is not null)
            {
                current.Dashboard.ThemeReadability = payload.ThemeReadability.Trim();
            }

            if (payload.ReleaseChannel is not null)
            {
                current.Dashboard.ReleaseChannel = payload.ReleaseChannel.Trim();
            }

            if (payload.UpdateRollbackEnabled.HasValue)
            {
                current.Dashboard.UpdateRollbackEnabled = payload.UpdateRollbackEnabled.Value;
            }

            return current;
        });

        await WriteJsonAsync(response, 200, BuildConfigSnapshot(), cancellationToken);
    }

    private async Task HandleConfigResetAsync(HttpListenerResponse response, CancellationToken cancellationToken)
    {
        _configStore.ResetLocalData();
        await WriteJsonAsync(response, 200, new
        {
            ok = true,
            message = "Local settings and protected secrets were reset.",
            config = BuildConfigSnapshot(),
            health = await BuildHealthPayloadAsync(cancellationToken)
        }, cancellationToken);
    }

    private async Task HandleSupportBundleAsync(HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var config = _configStore.Snapshot();
        var health = await BuildHealthPayloadAsync(cancellationToken);

        response.AddHeader("Content-Disposition", "attachment; filename=\"xenon-support-bundle.json\"");
        await WriteJsonAsync(response, 200, new
        {
            generatedAt = DateTimeOffset.UtcNow,
            app = new
            {
                name = "XENEON Edge Host",
                version = typeof(BridgeManager).Assembly.GetName().Version?.ToString() ?? "unknown",
                dashboardAssetRevision = DashboardAssetRevision,
                dashboardUrl = DashboardUri.ToString()
            },
            config = BuildSupportConfigSnapshot(config),
            health = SanitizeSupportObject(health, config),
            display = BuildDisplayDiagnostics(config),
            releaseSafety = BuildSupportRollbackPayload(BuildRollbackPayload()),
            log = ReadRecentLogLines(120, config)
        }, cancellationToken);
    }

    private async Task HandleWeatherConfigUpdateAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<WeatherConfigRequest>(request, cancellationToken);
        _configStore.Update(current =>
        {
            if (!string.IsNullOrWhiteSpace(payload.ApiKey))
            {
                current.Weather.ApiKey = payload.ApiKey.Trim();
            }

            if (!string.IsNullOrWhiteSpace(payload.City))
            {
                current.Weather.City = payload.City.Trim();
            }

            current.Weather.Units = string.Equals(payload.Units, "imperial", StringComparison.OrdinalIgnoreCase)
                ? "imperial"
                : "metric";
            return current;
        });

        await WriteJsonAsync(response, 200, BuildConfigSnapshot(), cancellationToken);
    }

    private async Task HandleCalendarConfigUpdateAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<CalendarConfigRequest>(request, cancellationToken);
        _configStore.Update(current =>
        {
            current.Calendar.IcsUrl = payload.IcsUrl?.Trim() ?? "";
            return current;
        });

        await WriteJsonAsync(response, 200, BuildConfigSnapshot(), cancellationToken);
    }

    private async Task HandleLauncherConfigUpdateAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<LaunchersUpdateRequest>(request, cancellationToken);
        var entries = _launcherService.NormalizeEntries(payload.Entries);
        var updatedConfig = _configStore.Update(current =>
        {
            current.Launchers = entries;
            return current;
        });

        await WriteJsonAsync(response, 200, _launcherService.GetSnapshot(updatedConfig), cancellationToken);
    }

    private async Task HandleLauncherSuggestionApplyAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<LauncherSuggestionApplyRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, _provisioningService.ApplyLauncherSuggestions(payload.Ids), cancellationToken);
    }

    private async Task HandleDisplayPreferenceAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<DisplayPreferenceRequest>(request, cancellationToken);
        var displayId = payload.DisplayId?.Trim() ?? "";
        var diagnostics = BuildDisplayDiagnostics();
        var selected = diagnostics.Displays.FirstOrDefault(display =>
            string.Equals(display.Id, displayId, StringComparison.OrdinalIgnoreCase)
            || string.Equals(display.DeviceName, displayId, StringComparison.OrdinalIgnoreCase)
            || string.Equals(display.DeviceId, displayId, StringComparison.OrdinalIgnoreCase));

        if (selected is null)
        {
            throw new InvalidOperationException("Display candidate not found.");
        }

        _configStore.Update(current =>
        {
            current.Dashboard.PreferredDisplayId = selected.Id;
            current.Dashboard.PreferredDisplayDeviceName = selected.DeviceName;
            current.Dashboard.DisplaySelectedAt = DateTime.UtcNow.ToString("O");
            return current;
        });

        await WriteJsonAsync(response, 200, BuildDisplayDiagnostics(), cancellationToken);
    }

    private async Task HandleLauncherLaunchAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<LauncherLaunchRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, _launcherService.Launch(_configStore.Snapshot(), payload.Id), cancellationToken);
    }

    private async Task HandleLauncherIconAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var id = GetQueryValue(request, "id");
        if (!_launcherService.TryGetIcon(_configStore.Snapshot(), id, out var asset))
        {
            await WriteTextAsync(response, 404, "Launcher icon not found", cancellationToken);
            return;
        }

        await WriteBinaryAsync(response, 200, asset.ContentType, asset.Content, cancellationToken);
    }

    private async Task HandleSteamGameLaunchAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<SteamGameLaunchRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, _steamService.Launch(payload.AppId), cancellationToken);
    }

    private async Task HandleSteamGameArtworkAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var appId = GetQueryValue(request, "id");
        if (!_steamService.TryGetArtwork(appId, out var asset))
        {
            await WriteTextAsync(response, 404, "Steam game artwork not found", cancellationToken);
            return;
        }

        await WriteBinaryAsync(response, 200, asset.ContentType, asset.Content, cancellationToken);
    }

    private async Task HandleGameActivityPinAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<GameActivityPinRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, _gameActivityService.PinCandidate(payload), cancellationToken);
    }

    private async Task HandleWeatherRequestAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var config = _configStore.Snapshot();
        var city = GetQueryValue(request, "city");
        var units = GetQueryValue(request, "units");
        var snapshot = await _weatherService.GetSnapshotAsync(config, city, units, cancellationToken);
        await WriteJsonAsync(response, 200, snapshot, cancellationToken);
    }

    private async Task HandleBrightnessUpdateAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<BrightnessRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, _systemActionsService.SetBrightness(payload.Brightness), cancellationToken);
    }

    private async Task HandleAudioDefaultDeviceAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<AudioDeviceRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, await _audioService.SetDefaultDeviceAsync(payload.DeviceId, cancellationToken), cancellationToken);
    }

    private async Task HandleAudioMasterVolumeAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<AudioVolumeRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, await _audioService.SetMasterVolumeAsync(payload.Volume, cancellationToken), cancellationToken);
    }

    private async Task HandleAudioMasterMuteAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<AudioMuteRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, await _audioService.SetMasterMuteAsync(payload.Muted, cancellationToken), cancellationToken);
    }

    private async Task HandleAudioSessionVolumeAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<AudioSessionVolumeRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, await _audioService.SetSessionVolumeAsync(payload.SessionId, payload.Volume, cancellationToken), cancellationToken);
    }

    private async Task HandleAudioSessionMuteAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<AudioSessionMuteRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, await _audioService.SetSessionMuteAsync(payload.SessionId, payload.Muted, cancellationToken), cancellationToken);
    }

    private async Task HandleHueLinkAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<HueLinkRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, await _hueService.LinkBridgeAsync(payload.BridgeIp, cancellationToken), cancellationToken);
    }

    private async Task HandleUniFiLinkAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<UniFiLinkRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, await _uniFiService.LinkAsync(payload, _networkMetrics.GetSnapshot(), cancellationToken), cancellationToken);
    }

    private async Task HandleClipboardCopyAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var payload = await ReadJsonAsync<ClipboardCopyRequest>(request, cancellationToken);
        await WriteJsonAsync(response, 200, await _clipboardHistoryService.CopyItemAsync(payload.Id, cancellationToken), cancellationToken);
    }

    private async Task<bool> TryHandleQuickActionAsync(string path, HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        if (request.HttpMethod != "POST")
        {
            return false;
        }

        var match = System.Text.RegularExpressions.Regex.Match(path, "^/api/quick-actions/([^/]+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!match.Success)
        {
            return false;
        }

        var actionId = Uri.UnescapeDataString(match.Groups[1].Value);
        await WriteJsonAsync(response, 200, _systemActionsService.ExecuteQuickAction(actionId), cancellationToken);
        return true;
    }

    private async Task<bool> TryHandleSystemShortcutActionAsync(string path, HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        if (request.HttpMethod != "POST")
        {
            return false;
        }

        var match = System.Text.RegularExpressions.Regex.Match(path, "^/api/system-shortcuts/([^/]+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!match.Success || string.Equals(match.Groups[1].Value, "brightness", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var actionId = Uri.UnescapeDataString(match.Groups[1].Value);
        await WriteJsonAsync(response, 200, _systemActionsService.ExecuteShortcut(actionId), cancellationToken);
        return true;
    }

    private async Task<bool> TryHandleHueActionAsync(string path, HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        if (request.HttpMethod != "POST")
        {
            return false;
        }

        var lightToggleMatch = System.Text.RegularExpressions.Regex.Match(path, "^/api/hue/lights/([^/]+)/toggle$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (lightToggleMatch.Success)
        {
            var payload = await ReadJsonAsync<HueToggleRequest>(request, cancellationToken);
            await _hueService.SetLightStateAsync(_configStore.Snapshot(), Uri.UnescapeDataString(lightToggleMatch.Groups[1].Value), new
            {
                on = payload.State
            }, cancellationToken);
            await WriteJsonAsync(response, 200, new { ok = true }, cancellationToken);
            return true;
        }

        var lightBrightnessMatch = System.Text.RegularExpressions.Regex.Match(path, "^/api/hue/lights/([^/]+)/brightness$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (lightBrightnessMatch.Success)
        {
            var payload = await ReadJsonAsync<HueBrightnessRequest>(request, cancellationToken);
            var brightness = Math.Clamp(payload.Brightness, 0, 100);
            await _hueService.SetLightStateAsync(_configStore.Snapshot(), Uri.UnescapeDataString(lightBrightnessMatch.Groups[1].Value), new
            {
                on = brightness > 0,
                bri = Math.Clamp((int)Math.Round((brightness / 100d) * 254d), 1, 254)
            }, cancellationToken);
            await WriteJsonAsync(response, 200, new { ok = true }, cancellationToken);
            return true;
        }

        var groupToggleMatch = System.Text.RegularExpressions.Regex.Match(path, "^/api/hue/groups/([^/]+)/toggle$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (groupToggleMatch.Success)
        {
            var payload = await ReadJsonAsync<HueToggleRequest>(request, cancellationToken);
            await _hueService.SetGroupStateAsync(_configStore.Snapshot(), Uri.UnescapeDataString(groupToggleMatch.Groups[1].Value), new
            {
                on = payload.State
            }, cancellationToken);
            await WriteJsonAsync(response, 200, new { ok = true }, cancellationToken);
            return true;
        }

        var groupBrightnessMatch = System.Text.RegularExpressions.Regex.Match(path, "^/api/hue/groups/([^/]+)/brightness$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (groupBrightnessMatch.Success)
        {
            var payload = await ReadJsonAsync<HueBrightnessRequest>(request, cancellationToken);
            var brightness = Math.Clamp(payload.Brightness, 0, 100);
            await _hueService.SetGroupStateAsync(_configStore.Snapshot(), Uri.UnescapeDataString(groupBrightnessMatch.Groups[1].Value), brightness > 0
                ? new
                {
                    on = true,
                    bri = Math.Clamp((int)Math.Round((brightness / 100d) * 254d), 1, 254)
                }
                : new
                {
                    on = false
                }, cancellationToken);
            await WriteJsonAsync(response, 200, new { ok = true }, cancellationToken);
            return true;
        }

        return false;
    }

    private DisplayDiagnosticsSnapshot BuildDisplayDiagnostics(AppConfig? config = null)
    {
        var snapshot = config ?? _configStore.Snapshot();
        return DisplayManager.BuildDiagnostics(snapshot.Dashboard.PreferredDisplayId);
    }

    private async Task<object> RunAutoRepairAsync(CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var actions = new List<object>();
        var config = _configStore.Snapshot();
        var display = BuildDisplayDiagnostics(config);
        var provisioning = _provisioningService.RunStartupProvisioning(forceLauncherScan: true);
        var health = await BuildHealthPayloadAsync(cancellationToken);

        actions.Add(new
        {
            id = "config-normalized",
            state = "Ready",
            message = "Local config was loaded, normalized, and re-saved."
        });
        actions.Add(new
        {
            id = "display",
            state = display.EdgeCandidateCount > 0 ? "Ready" : "Needs Setup",
            message = display.Message,
            repairActions = display.RepairActions
        });
        actions.Add(new
        {
            id = "provisioning",
            state = provisioning.Status,
            message = provisioning.Message
        });
        actions.Add(new
        {
            id = "webview2",
            state = App.RuntimeInfo.IsAvailable ? "Ready" : "Needs Setup",
            message = App.RuntimeInfo.IsAvailable
                ? $"WebView2 runtime detected ({App.RuntimeInfo.Version ?? "unknown"})."
                : "Install or bundle WebView2 before the dashboard can render."
        });
        actions.Add(new
        {
            id = "rollback",
            state = BuildRollbackPayload().Configured ? "Ready" : "Optional",
            message = "Rollback metadata was checked for the current install."
        });

        return new
        {
            ok = true,
            supported = true,
            status = display.EdgeCandidateCount > 0 ? "ready" : "needs-setup",
            sampledAt = startedAt,
            message = "Auto repair checked display targeting, runtime health, launcher suggestions, and config state.",
            actions,
            health
        };
    }

    private string GetReleaseChannel(HttpListenerRequest request)
    {
        var requested = GetQueryValue(request, "channel");
        if (!string.IsNullOrWhiteSpace(requested))
        {
            return requested;
        }

        return _configStore.Snapshot().Dashboard.ReleaseChannel;
    }

    private RollbackPayload BuildRollbackPayload()
    {
        var config = _configStore.Snapshot();
        var path = config.Dashboard.LastKnownGoodPath;
        var configured = config.Dashboard.UpdateRollbackEnabled
            && !string.IsNullOrWhiteSpace(path)
            && File.Exists(path);

        return new RollbackPayload
        {
            Supported = true,
            Configured = configured,
            Status = configured ? "ready" : "unavailable",
            RollbackEnabled = config.Dashboard.UpdateRollbackEnabled,
            LastKnownGoodVersion = config.Dashboard.LastKnownGoodVersion,
            LastKnownGoodPath = configured ? path : "",
            Message = configured
                ? "A last-known-good install path is available for rollback."
                : "Rollback will be available after Xenon records a healthy installed build."
        };
    }

    private static object BuildSupportRollbackPayload(RollbackPayload rollback)
    {
        return new
        {
            supported = rollback.Supported,
            configured = rollback.Configured,
            status = rollback.Status,
            rollbackEnabled = rollback.RollbackEnabled,
            lastKnownGoodVersion = rollback.LastKnownGoodVersion,
            lastKnownGoodPathConfigured = !string.IsNullOrWhiteSpace(rollback.LastKnownGoodPath),
            message = rollback.Message
        };
    }

    private async Task<object> BuildHealthPayloadAsync(CancellationToken cancellationToken)
    {
        var config = _configStore.Snapshot();
        var launchers = _launcherService.GetSnapshot(config);
        var quickActions = _systemActionsService.GetQuickActionsSnapshot();
        var shortcuts = _systemActionsService.GetShortcutsSnapshot();
        var audio = await _audioService.GetSnapshotAsync(cancellationToken);
        var calendar = await _calendarService.GetSnapshotAsync(config, cancellationToken);
        var media = await _mediaService.GetSnapshotAsync(cancellationToken);
        var hue = await _hueService.GetSnapshotAsync(config, cancellationToken);
        var clipboard = await _clipboardHistoryService.GetSnapshotAsync(cancellationToken);
        var gpuPower = _gpuPowerMonitor.GetSnapshot();
        var provisioning = _provisioningService.GetSnapshot();
        var displayDiagnostics = BuildDisplayDiagnostics(config);
        var displayItem = CreateSetupItem(
            "display",
            "XENEON EDGE display",
            displayDiagnostics.EdgeCandidateCount > 0 ? "Ready" : "Needs Setup",
            true,
            displayDiagnostics.Message);

        var bridge = CreateSetupItem("bridge", "Local app service", "Ready", true, $"Running at {BuildBaseUri(config.Port)}.");
        var system = CreateSetupItem("system", "System Monitor", "Ready", true, "Native system telemetry is live.");
        var provisioningItem = CreateSetupItem(
            "provisioning",
            "Auto provisioning",
            string.Equals(provisioning.Status, "live", StringComparison.OrdinalIgnoreCase) ? "Ready" : "Checking",
            true,
            TextOr(provisioning.Message, "Xenon scans this PC and prepares safe defaults automatically."));
        var gpuPowerItem = CreateSetupItem(
            "gpu-power",
            "GPU Power Monitor",
            gpuPower.Status == "error" ? "Optional" : "Ready",
            false,
            TextOr(gpuPower.Message, "GPU connector and rail telemetry is ready when exposed by local sensor tools."));
        var network = CreateSetupItem("network", "Network Monitor", "Ready", true, "Native network telemetry is live.");
        var launcherItem = CreateSetupItem(
            "launchers",
            "App Launcher",
            launchers.Configured ? "Ready" : "Optional",
            false,
            TextOr(launchers.Message, "Xenon scans Start Menu shortcuts and Steam games automatically."));
        var quickActionsItem = CreateSetupItem(
            "quick-actions",
            "Quick Actions",
            "Ready",
            false,
            TextOr(quickActions.Message, "Built-in Windows quick actions are ready."));
        var shortcutsItem = CreateSetupItem(
            "shortcuts",
            "System Shortcuts",
            "Ready",
            false,
            TextOr(shortcuts.Message, "Power, brightness, and notification shortcuts are ready."));
        var audioItem = CreateSetupItem(
            "audio",
            "Audio & Media",
            audio.Configured ? "Ready" : "Optional",
            false,
            audio.Configured
                ? $"Core Audio is live with {audio.Devices.Count} playback outputs. Media controls are {TextOr(media.Status, "ready")}."
                : TextOr(audio.Message, "No playback outputs were detected."));
        var weather = !string.IsNullOrWhiteSpace(config.Weather.ApiKey)
            ? CreateSetupItem("weather", "Weather", "Ready", false, $"Configured for {config.Weather.City} in {config.Weather.Units} units.")
            : CreateSetupItem("weather", "Weather", "Optional", false, "Add an OpenWeather key if you want the Weather widget.");
        var calendarItem = !string.IsNullOrWhiteSpace(config.Calendar.IcsUrl)
            ? CreateSetupItem(
                "calendar",
                "Calendar",
                calendar.Status == "error" ? "Needs Setup" : "Ready",
                false,
                TextOr(calendar.Message, "Upcoming ICS events are live."))
            : CreateSetupItem("calendar", "Calendar", "Optional", false, "Add an ICS feed URL if you want the Calendar widget.");
        var mediaItem = CreateSetupItem(
            "media",
            "Audio & Media",
            audio.Configured ? "Ready" : media.Status == "error" ? "Needs Setup" : "Ready",
            false,
            media.Status == "idle"
                ? "Windows media transport is ready inside Audio & Media."
                : TextOr(media.Message, "Windows media transport controls are live inside Audio & Media."));
        var clipboardItem = CreateSetupItem(
            "clipboard",
            "Clipboard History",
            clipboard.Status == "error" ? "Needs Setup" : clipboard.Status == "setup" ? "Optional" : "Ready",
            false,
            TextOr(clipboard.Message, "Clipboard history is live."));
        var hueItem = !string.IsNullOrWhiteSpace(config.Hue.BridgeIp)
            ? CreateSetupItem("hue", "Philips Hue", hue.Linked ? "Ready" : "Needs Setup", false, TextOr(hue.Message, hue.Linked ? "Linked to your Hue Bridge." : "Press the bridge button, then link it from Diagnostics."))
            : CreateSetupItem("hue", "Philips Hue", "Optional", false, "Add your Hue Bridge only if you want local light control.");
        var uniFi = _uniFiService.GetCachedNetworkPayload(_networkMetrics.GetSnapshot());
        var uniFiItem = uniFi.Linked
            ? CreateSetupItem("unifi", "UniFi Network", "Ready", false, $"Linked locally to {uniFi.Gateway}.")
            : uniFi.Configured && string.Equals(uniFi.Status, "error", StringComparison.OrdinalIgnoreCase)
                ? CreateSetupItem("unifi", "UniFi Network", "Needs Setup", false, TextOr(uniFi.Message, "Reconnect UniFi from the Network page."))
                : uniFi.Detected
                    ? CreateSetupItem("unifi", "UniFi Network", "Detected", false, $"Found UniFi locally at {uniFi.GatewayIp}. Connect from the Network page for clients and APs.")
                    : string.Equals(uniFi.Status, "checking", StringComparison.OrdinalIgnoreCase)
                        ? CreateSetupItem("unifi", "UniFi Network", "Checking", false, "Xenon is checking for a local UniFi console in the background.")
                        : CreateSetupItem("unifi", "UniFi Network", "Optional", false, "Network Monitor works now. Link UniFi locally when you want gateway detail.");

        return new
        {
            ok = true,
            capabilities = new
            {
                system = true,
                display = true,
                gpuPower = true,
                network = true,
                launchers = true,
                quickActions = true,
                shortcuts = true,
                audio = true,
                weather = true,
                calendar = true,
                media = true,
                clipboard = true,
                hue = true,
                unifi = true,
                gameActivity = true
            },
            setup = new
            {
                essentialsReady = true,
                onboardingCompleted = config.Dashboard.OnboardingCompleted,
                onboardingCompletedAt = config.Dashboard.OnboardingCompletedAt,
                onboardingVersion = config.Dashboard.OnboardingVersion,
                needsAttention = (!string.IsNullOrWhiteSpace(config.Calendar.IcsUrl) && calendar.Status == "error")
                    || (!string.IsNullOrWhiteSpace(config.Hue.BridgeIp) && !hue.Linked)
                    || displayDiagnostics.EdgeCandidateCount == 0,
                provisioning,
                display = displayDiagnostics,
                items = new Dictionary<string, object>
                {
                    ["bridge"] = bridge,
                    ["provisioning"] = provisioningItem,
                    ["display"] = displayItem,
                    ["system"] = system,
                    ["gpu-power"] = gpuPowerItem,
                    ["network"] = network,
                    ["launchers"] = launcherItem,
                    ["quick-actions"] = quickActionsItem,
                    ["shortcuts"] = shortcutsItem,
                    ["audio"] = audioItem,
                    ["weather"] = weather,
                    ["calendar"] = calendarItem,
                    ["media"] = mediaItem,
                    ["clipboard"] = clipboardItem,
                    ["hue"] = hueItem,
                    ["unifi"] = uniFiItem
                }
            }
        };
    }

    private object BuildConfigSnapshot()
    {
        var config = _configStore.Snapshot();
        return new
        {
            port = config.Port,
            provisioning = _provisioningService.GetSnapshot(),
            display = BuildDisplayDiagnostics(config),
            weather = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Weather.ApiKey),
                city = config.Weather.City,
                units = config.Weather.Units,
                secureStorage = "Windows DPAPI"
            },
            calendar = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Calendar.IcsUrl),
                icsUrl = config.Calendar.IcsUrl
            },
            launchers = new
            {
                configured = config.Launchers.Count > 0,
                count = config.Launchers.Count
            },
            gpuPower = new
            {
                configured = true,
                endpoint = "/api/gpu-power",
                localOnly = true,
                source = "Windows/LHM/OHM/HWiNFO CSV"
            },
            hue = new
            {
                bridgeIp = config.Hue.BridgeIp,
                configured = !string.IsNullOrWhiteSpace(config.Hue.BridgeIp),
                linked = !string.IsNullOrWhiteSpace(config.Hue.AppKey),
                secureStorage = "Windows DPAPI"
            },
            unifi = new
            {
                configured = !string.IsNullOrWhiteSpace(config.UniFi.Host),
                linked = !string.IsNullOrWhiteSpace(config.UniFi.Host)
                    && !string.IsNullOrWhiteSpace(config.UniFi.Username)
                    && !string.IsNullOrWhiteSpace(config.UniFi.Password),
                host = config.UniFi.Host,
                usernameConfigured = !string.IsNullOrWhiteSpace(config.UniFi.Username),
                site = config.UniFi.Site,
                endpoint = "/api/unifi/network",
                linkEndpoint = "/api/unifi/network/link",
                disconnectEndpoint = "/api/unifi/network/disconnect",
                localOnly = true,
                secureStorage = "Windows DPAPI"
            },
            dashboard = new
            {
                autoProvisioningEnabled = config.Dashboard.AutoProvisioningEnabled,
                autoProvisionedAt = config.Dashboard.AutoProvisionedAt,
                autoProvisioningVersion = config.Dashboard.AutoProvisioningVersion,
                launcherReviewRequired = config.Dashboard.LauncherReviewRequired,
                autoApplyLauncherSuggestions = config.Dashboard.AutoApplyLauncherSuggestions,
                onboardingCompleted = config.Dashboard.OnboardingCompleted,
                onboardingCompletedAt = config.Dashboard.OnboardingCompletedAt,
                onboardingVersion = config.Dashboard.OnboardingVersion,
                preferredDisplayId = config.Dashboard.PreferredDisplayId,
                preferredDisplayDeviceName = config.Dashboard.PreferredDisplayDeviceName,
                displaySelectedAt = config.Dashboard.DisplaySelectedAt,
                performanceBudget = config.Dashboard.PerformanceBudget,
                gameModeAutoTune = config.Dashboard.GameModeAutoTune,
                themeReadability = config.Dashboard.ThemeReadability,
                releaseChannel = config.Dashboard.ReleaseChannel,
                updateRollbackEnabled = config.Dashboard.UpdateRollbackEnabled,
                lastKnownGoodVersion = config.Dashboard.LastKnownGoodVersion,
                lastKnownGoodPath = string.IsNullOrWhiteSpace(config.Dashboard.LastKnownGoodPath) ? "" : "<local-app-path>"
            }
        };
    }

    private static object BuildSupportConfigSnapshot(AppConfig config)
    {
        return new
        {
            port = config.Port,
            weather = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Weather.ApiKey),
                cityConfigured = !string.IsNullOrWhiteSpace(config.Weather.City),
                units = config.Weather.Units,
                secureStorage = "Windows DPAPI"
            },
            calendar = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Calendar.IcsUrl)
            },
            launchers = new
            {
                configured = config.Launchers.Count > 0,
                count = config.Launchers.Count
            },
            gpuPower = new
            {
                configured = true,
                endpoint = "/api/gpu-power",
                localOnly = true
            },
            hue = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Hue.BridgeIp),
                linked = !string.IsNullOrWhiteSpace(config.Hue.AppKey),
                secureStorage = "Windows DPAPI"
            },
            unifi = new
            {
                configured = !string.IsNullOrWhiteSpace(config.UniFi.Host),
                linked = !string.IsNullOrWhiteSpace(config.UniFi.Host)
                    && !string.IsNullOrWhiteSpace(config.UniFi.Username)
                    && !string.IsNullOrWhiteSpace(config.UniFi.Password),
                hostConfigured = !string.IsNullOrWhiteSpace(config.UniFi.Host),
                usernameConfigured = !string.IsNullOrWhiteSpace(config.UniFi.Username),
                site = config.UniFi.Site,
                endpoint = "/api/unifi/network",
                localOnly = true,
                secureStorage = "Windows DPAPI"
            },
            dashboard = new
            {
                autoProvisioningEnabled = config.Dashboard.AutoProvisioningEnabled,
                autoProvisioned = !string.IsNullOrWhiteSpace(config.Dashboard.AutoProvisionedAt),
                autoProvisioningVersion = config.Dashboard.AutoProvisioningVersion,
                launcherReviewRequired = config.Dashboard.LauncherReviewRequired,
                autoApplyLauncherSuggestions = config.Dashboard.AutoApplyLauncherSuggestions,
                onboardingCompleted = config.Dashboard.OnboardingCompleted,
                onboardingCompletedAt = config.Dashboard.OnboardingCompletedAt,
                onboardingVersion = config.Dashboard.OnboardingVersion,
                preferredDisplayConfigured = !string.IsNullOrWhiteSpace(config.Dashboard.PreferredDisplayId),
                performanceBudget = config.Dashboard.PerformanceBudget,
                gameModeAutoTune = config.Dashboard.GameModeAutoTune,
                themeReadability = config.Dashboard.ThemeReadability,
                releaseChannel = config.Dashboard.ReleaseChannel,
                updateRollbackEnabled = config.Dashboard.UpdateRollbackEnabled,
                lastKnownGoodConfigured = !string.IsNullOrWhiteSpace(config.Dashboard.LastKnownGoodPath)
            }
        };
    }

    private static object BuildUnsupportedFeaturePayload(string status, string message, object? extra = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["supported"] = false,
            ["configured"] = false,
            ["status"] = status,
            ["source"] = "native host",
            ["message"] = message,
            ["sampledAt"] = null,
            ["stale"] = false,
            ["error"] = message
        };

        if (extra is not null)
        {
            foreach (var property in extra.GetType().GetProperties())
            {
                payload[property.Name[..1].ToLowerInvariant() + property.Name[1..]] = property.GetValue(extra);
            }
        }

        return payload;
    }

    private static object CreateSetupItem(string id, string label, string state, bool required, string nextStep)
    {
        return new
        {
            id,
            label,
            state,
            required,
            nextStep
        };
    }

    private static string TextOr(string? value, string fallback)
    {
        return string.IsNullOrWhiteSpace(value) ? fallback : value;
    }

    private string[] ReadRecentLogLines(int maxLines, AppConfig? config = null)
    {
        try
        {
            if (!File.Exists(_logger.LogPath))
            {
                return [];
            }

            return File.ReadLines(_logger.LogPath)
                .TakeLast(Math.Max(1, maxLines))
                .Select(line => SanitizeSupportText(line, config))
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private static object SanitizeSupportObject(object payload, AppConfig config)
    {
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        var sanitized = SanitizeSupportText(json, config);
        return JsonSerializer.Deserialize<JsonElement>(sanitized, JsonOptions);
    }

    private static string SanitizeSupportText(string value, AppConfig? config = null)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        var sanitized = value;

        if (config is not null)
        {
            sanitized = ReplaceIfPresent(sanitized, config.Weather.City, "<weather-location>");
            sanitized = ReplaceIfPresent(sanitized, config.Calendar.IcsUrl, "<calendar-feed-url>");
            sanitized = ReplaceIfPresent(sanitized, config.Hue.BridgeIp, "<local-ip>");
            sanitized = ReplaceIfPresent(sanitized, config.UniFi.Host, "<local-ip>");
            sanitized = ReplaceIfPresent(sanitized, config.UniFi.Username, "<unifi-user>");

            foreach (var launcher in config.Launchers)
            {
                sanitized = ReplaceIfPresent(sanitized, launcher.ExecutablePath, "<launcher-path>");
                sanitized = ReplaceIfPresent(sanitized, launcher.IconPath, "<launcher-icon-path>");
                sanitized = ReplaceIfPresent(sanitized, launcher.Arguments, "<launcher-arguments>");
            }
        }

        sanitized = WindowsUserPathPattern.Replace(sanitized, @"C:\Users\<user>");
        sanitized = MacUserPathPattern.Replace(sanitized, "/Users/<user>");
        sanitized = EmailPattern.Replace(sanitized, "<email>");
        sanitized = PrivateIpPattern.Replace(sanitized, "<local-ip>");
        sanitized = SensitiveQueryPattern.Replace(sanitized, "${name}=<redacted>");

        return sanitized;
    }

    private static string ReplaceIfPresent(string source, string? value, string replacement)
    {
        return string.IsNullOrWhiteSpace(value)
            ? source
            : source.Replace(value, replacement, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<T> ReadJsonAsync<T>(HttpListenerRequest request, CancellationToken cancellationToken)
        where T : new()
    {
        if (request.ContentLength64 > MaxJsonBodyBytes)
        {
            throw new RequestBodyTooLargeException(MaxJsonBodyBytes);
        }

        var encoding = request.ContentEncoding ?? Encoding.UTF8;
        using var memory = new MemoryStream();
        var buffer = new byte[8192];

        while (true)
        {
            var read = await request.InputStream.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                break;
            }

            if (memory.Length + read > MaxJsonBodyBytes)
            {
                throw new RequestBodyTooLargeException(MaxJsonBodyBytes);
            }

            memory.Write(buffer, 0, read);
        }

        var body = encoding.GetString(memory.ToArray());
        if (string.IsNullOrWhiteSpace(body))
        {
            return new T();
        }

        return JsonSerializer.Deserialize<T>(body, JsonOptions) ?? new T();
    }

    private static async Task WriteJsonAsync(HttpListenerResponse response, int statusCode, object payload, CancellationToken cancellationToken)
    {
        response.StatusCode = statusCode;
        response.ContentType = "application/json; charset=utf-8";

        if (statusCode == 204)
        {
            response.ContentLength64 = 0;
            response.Close();
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, JsonOptions));
        response.ContentLength64 = bytes.LongLength;
        await response.OutputStream.WriteAsync(bytes, cancellationToken);
        response.Close();
    }

    private static async Task WriteTextAsync(HttpListenerResponse response, int statusCode, string text, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        response.StatusCode = statusCode;
        response.ContentType = "text/plain; charset=utf-8";
        response.ContentLength64 = bytes.LongLength;
        await response.OutputStream.WriteAsync(bytes, cancellationToken);
        response.Close();
    }

    private static async Task WriteBinaryAsync(HttpListenerResponse response, int statusCode, string contentType, byte[] content, CancellationToken cancellationToken)
    {
        response.StatusCode = statusCode;
        response.ContentType = contentType;
        response.Headers["Cache-Control"] = "public, max-age=604800";
        response.ContentLength64 = content.LongLength;
        await response.OutputStream.WriteAsync(content, cancellationToken);
        response.Close();
    }

    private static async Task WriteAssetAsync(HttpListenerResponse response, EmbeddedAsset asset, CancellationToken cancellationToken)
    {
        response.StatusCode = 200;
        response.ContentType = asset.ContentType;
        response.Headers["Cache-Control"] = ShouldDisableCaching(asset.Path)
            ? "no-cache, no-store, must-revalidate"
            : "public, max-age=604800";
        response.ContentLength64 = asset.Content.LongLength;
        await response.OutputStream.WriteAsync(asset.Content, cancellationToken);
        response.Close();
    }

    private static bool ShouldDisableCaching(string path)
    {
        if (path.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".js", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return false;
    }

    private static Uri BuildBaseUri(int port)
    {
        return new Uri($"http://127.0.0.1:{port}/");
    }

    private static HashSet<string> BuildAllowedOrigins(int port)
    {
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            $"http://127.0.0.1:{port}",
            $"http://localhost:{port}"
        };
    }

    private bool TryAuthorizeOrigin(HttpListenerRequest request, out string? corsOrigin)
    {
        corsOrigin = null;
        var origin = NormalizeOrigin(request.Headers["Origin"]);
        if (string.IsNullOrWhiteSpace(origin))
        {
            return true;
        }

        if (!_allowedOrigins.Contains(origin))
        {
            _logger.Warn($"Rejected local dashboard request from origin {origin}.");
            return false;
        }

        corsOrigin = origin;
        return true;
    }

    private static string NormalizeOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin))
        {
            return "";
        }

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
        {
            return origin.Trim().TrimEnd('/');
        }

        return uri.IsDefaultPort
            ? $"{uri.Scheme}://{uri.Host}"
            : $"{uri.Scheme}://{uri.Host}:{uri.Port}";
    }

    private void LogRequestBoundary(string requestId, string method, string path, int statusCode, TimeSpan elapsed)
    {
        var payload = new
        {
            eventName = "http_request",
            requestId,
            method,
            path = SanitizeSupportText(path),
            statusCode,
            durationMs = Math.Round(elapsed.TotalMilliseconds, 1)
        };

        _logger.Info(JsonSerializer.Serialize(payload, JsonOptions));
    }

    private static string CreateRequestId()
    {
        return Guid.NewGuid().ToString("N")[..12];
    }

    private static void ApplyCorsHeaders(HttpListenerResponse response, string? corsOrigin)
    {
        if (string.IsNullOrWhiteSpace(corsOrigin))
        {
            return;
        }

        response.Headers["Access-Control-Allow-Origin"] = corsOrigin;
        response.Headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,OPTIONS";
        response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
        response.Headers["Vary"] = "Origin";
    }

    private static string GetQueryValue(HttpListenerRequest request, string key)
    {
        var query = request.Url?.Query;
        if (string.IsNullOrWhiteSpace(query))
        {
            return "";
        }

        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split('=', 2);
            if (!string.Equals(Uri.UnescapeDataString(parts[0]), key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "";
        }

        return "";
    }

    private static bool IsTruthyQueryValue(HttpListenerRequest request, string key)
    {
        var value = GetQueryValue(request, key);
        return string.Equals(value, "1", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "yes", StringComparison.OrdinalIgnoreCase);
    }

    private void RaiseStatus(string message)
    {
        StatusChanged?.Invoke(message);
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    private sealed class RequestBodyTooLargeException : Exception
    {
        public RequestBodyTooLargeException(int maxBytes)
            : base($"Request body must be {maxBytes} bytes or smaller.")
        {
        }
    }
}

public sealed class RollbackPayload
{
    public bool Supported { get; set; }

    public bool Configured { get; set; }

    public string Status { get; set; } = "";

    public bool RollbackEnabled { get; set; }

    public string LastKnownGoodVersion { get; set; } = "";

    public string LastKnownGoodPath { get; set; } = "";

    public string Message { get; set; } = "";
}
