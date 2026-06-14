using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class BridgeManager : IDisposable
{
    private const string SessionHeaderName = "X-Xenon-Session";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly SemaphoreSlim _lifecycleLock = new(1, 1);
    private readonly HostLogger _logger = App.Logger;
    private readonly ConfigStore _configStore;
    private readonly EmbeddedAssetProvider _assetProvider;
    private readonly StaticAssetController _staticAssets;
    private readonly ConfigController _configController;
    private readonly TelemetryController _telemetryController;
    private readonly ActionController _actionController;
    private readonly SupportController _supportController;
    private readonly ReleaseController _releaseController;
    private readonly ApiRouter _apiRouter;
    private readonly string _dashboardAssetRevision;
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
    private readonly GamePerformanceService _gamePerformanceService;
    private readonly GameModeSessionService _gameModeSessionService;
    private readonly GameController _gameController;
    private readonly ProvisioningService _provisioningService;
    private readonly SystemActionsService _systemActionsService;
    private readonly ClipboardHistoryService _clipboardHistoryService;
    private readonly HttpClient _weatherHttpClient;
    private readonly HashSet<string> _allowedOrigins;
    private readonly string _sessionToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    private HttpListener? _listener;
    private CancellationTokenSource? _serverCancellation;
    private Task? _serverTask;
    private bool _disposed;

    public BridgeManager()
    {
        _configStore = new ConfigStore(_logger);
        _assetProvider = new EmbeddedAssetProvider();
        _staticAssets = new StaticAssetController(_assetProvider, _sessionToken);
        _dashboardAssetRevision = _staticAssets.AssetRevision;
        _systemMetrics = new SystemMetricsService(_logger);
        _gpuPowerMonitor = new GpuPowerMonitorService(_logger);
        _networkMetrics = new NetworkMetricsService(_logger, _configStore);
        _audioService = new AudioService(_logger, _configStore);
        _weatherHttpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(10)
        };
        _weatherService = new WeatherService(_weatherHttpClient);
        _calendarService = new CalendarService(_weatherHttpClient, _logger);
        _hueService = new HueService(_configStore, _logger);
        _uniFiService = new UniFiService(_configStore, _logger);
        _releaseService = new ReleaseService(_weatherHttpClient);
        _mediaService = new MediaService(_logger, _configStore);
        _launcherService = new LauncherService(_logger);
        _steamService = new SteamService(_logger);
        _gameActivityService = new GameActivityService(_steamService, _launcherService, _configStore, _logger);
        _gamePerformanceService = new GamePerformanceService(_logger, _configStore);
        _gameModeSessionService = new GameModeSessionService(
            _systemMetrics,
            _networkMetrics,
            _audioService,
            _uniFiService,
            _steamService,
            _gameActivityService,
            _gamePerformanceService,
            _logger);
        _gameController = new GameController(_steamService, _gameActivityService, _gamePerformanceService, _gameModeSessionService);
        _provisioningService = new ProvisioningService(_configStore, _steamService, _logger);
        _systemActionsService = new SystemActionsService(_logger);
        _clipboardHistoryService = new ClipboardHistoryService(_logger);
        _configController = new ConfigController(_configStore, _provisioningService);
        _telemetryController = new TelemetryController(
            _configStore,
            _configController,
            _systemMetrics,
            _gpuPowerMonitor,
            _networkMetrics,
            _audioService,
            _calendarService,
            _hueService,
            _uniFiService,
            _mediaService,
            _clipboardHistoryService,
            _provisioningService,
            _launcherService,
            _systemActionsService);
        _actionController = new ActionController(
            _configStore,
            _launcherService,
            _provisioningService,
            _systemActionsService,
            _mediaService,
            _hueService,
            _clipboardHistoryService);
        _supportController = new SupportController(
            _logger,
            _configStore,
            _configController,
            _telemetryController,
            _provisioningService,
            _dashboardAssetRevision);
        _releaseController = new ReleaseController(
            _releaseService,
            _configController,
            _supportController);
        _apiRouter = new ApiRouter(
            _configStore,
            _staticAssets,
            _configController,
            _telemetryController,
            _actionController,
            _supportController,
            _gameController,
            _releaseController,
            _weatherService,
            _calendarService);

        var baseUri = BuildBaseUri(_configStore.Current.Port);
        _allowedOrigins = BuildAllowedOrigins(_configStore.Current.Port);
        DashboardUri = new Uri(baseUri, $"dashboard.html?v={Uri.EscapeDataString(_dashboardAssetRevision)}");
        SettingsUri = new Uri(baseUri, $"dashboard.html?advanced=1&v={Uri.EscapeDataString(_dashboardAssetRevision)}");
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
            _launcherService.Dispose();
            _gamePerformanceService.Dispose();
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

            if (!TryAuthorizeNoOriginMutation(request))
            {
                await WriteJsonAsync(response, 403, new { error = "Session token required." }, cancellationToken);
                return;
            }

            ApplyCorsHeaders(response, corsOrigin);

            if (request.HttpMethod == "OPTIONS")
            {
                await WriteJsonAsync(response, 204, new { }, cancellationToken);
                return;
            }

            await _apiRouter.HandleAsync(request, response, DashboardUri, cancellationToken);
            return;
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
        catch (InvalidJsonBodyException error)
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
        catch (InvalidOperationException error)
        {
            _logger.Warn($"Request validation failed: {error.Message}");
            try
            {
                await WriteJsonAsync(context.Response, 400, new { error = error.Message }, cancellationToken);
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
                await WriteJsonAsync(context.Response, 500, new { error = "Request failed.", requestId }, cancellationToken);
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

    private static async Task WriteJsonAsync(HttpListenerResponse response, int statusCode, object payload, CancellationToken cancellationToken)
    {
        response.StatusCode = statusCode;
        response.ContentType = "application/json; charset=utf-8";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["Referrer-Policy"] = "no-referrer";

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

    private bool TryAuthorizeNoOriginMutation(HttpListenerRequest request)
    {
        if (HasSafeMethod(request) || !string.IsNullOrWhiteSpace(request.Headers["Origin"]))
        {
            return true;
        }

        var token = request.Headers[SessionHeaderName];
        var authorized = string.Equals(token, _sessionToken, StringComparison.Ordinal);
        if (!authorized)
        {
            _logger.Warn($"Rejected no-origin {request.HttpMethod} request without a valid session token.");
        }

        return authorized;
    }

    private static bool HasSafeMethod(HttpListenerRequest request)
    {
        return string.Equals(request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase)
            || string.Equals(request.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase)
            || string.Equals(request.HttpMethod, "OPTIONS", StringComparison.OrdinalIgnoreCase);
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
            path = _supportController.SanitizeText(path),
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
        response.Headers["Access-Control-Allow-Headers"] = $"Content-Type, {SessionHeaderName}";
        response.Headers["Vary"] = "Origin";
    }

    private void RaiseStatus(string message)
    {
        StatusChanged?.Invoke(message);
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }
}
