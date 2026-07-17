using System.Net;
using System.Text;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class ApiRouter
{
    private const int MaxJsonBodyBytes = 256 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly ConfigStore _configStore;
    private readonly StaticAssetController _staticAssets;
    private readonly ConfigController _configController;
    private readonly TelemetryController _telemetryController;
    private readonly ActionController _actionController;
    private readonly SupportController _supportController;
    private readonly GameController _gameController;
    private readonly ReleaseController _releaseController;
    private readonly SceneController _sceneController;
    private readonly ActionChainController _actionChainController;
    private readonly MonitorControlController _monitorControlController;
    private readonly ExtensionController _extensionController;
    private readonly RemoteSessionController _remoteSessionController;
    private readonly LocalDataResetController _localDataResetController;
    private readonly RecoveryController _recoveryController;
    private readonly WeatherService _weatherService;
    private readonly CalendarService _calendarService;

    public ApiRouter(
        ConfigStore configStore,
        StaticAssetController staticAssets,
        ConfigController configController,
        TelemetryController telemetryController,
        ActionController actionController,
        SupportController supportController,
        GameController gameController,
        ReleaseController releaseController,
        SceneController sceneController,
        ActionChainController actionChainController,
        MonitorControlController monitorControlController,
        ExtensionController extensionController,
        RemoteSessionController remoteSessionController,
        LocalDataResetController localDataResetController,
        RecoveryController recoveryController,
        WeatherService weatherService,
        CalendarService calendarService)
    {
        _configStore = configStore;
        _staticAssets = staticAssets;
        _configController = configController;
        _telemetryController = telemetryController;
        _actionController = actionController;
        _supportController = supportController;
        _gameController = gameController;
        _releaseController = releaseController;
        _sceneController = sceneController;
        _actionChainController = actionChainController;
        _monitorControlController = monitorControlController;
        _extensionController = extensionController;
        _remoteSessionController = remoteSessionController;
        _localDataResetController = localDataResetController;
        _recoveryController = recoveryController;
        _weatherService = weatherService;
        _calendarService = calendarService;
    }

    public async Task HandleAsync(
        HttpListenerRequest request,
        HttpListenerResponse response,
        Uri dashboardUri,
        CancellationToken cancellationToken)
    {
        var path = request.Url?.AbsolutePath ?? "/";

        switch (path)
        {
            case "/favicon.ico":
                await WriteJsonAsync(response, 204, new { }, cancellationToken);
                return;
            case "/api/health":
                await WriteJsonAsync(response, 200, await _telemetryController.BuildHealthPayloadAsync(cancellationToken), cancellationToken);
                return;
            case "/api/provisioning" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _actionController.GetProvisioningSnapshot(), cancellationToken);
                return;
            case "/api/provisioning/run" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _actionController.RunProvisioning(), cancellationToken);
                return;
            case "/api/provisioning/launchers/apply" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _actionController.ApplyLauncherSuggestions(await ReadJsonAsync<LauncherSuggestionApplyRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/repair/run" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _supportController.RunAutoRepairAsync(cancellationToken), cancellationToken);
                return;
            case "/api/display/diagnostics" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _configController.GetDisplayDiagnostics(), cancellationToken);
                return;
            case "/api/display/preference" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _configController.SetDisplayPreference(await ReadJsonAsync<DisplayPreferenceRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/config" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _configController.GetSnapshot(), cancellationToken);
                return;
            case "/api/config/dashboard" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _configController.UpdateDashboard(await ReadJsonAsync<DashboardConfigRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/config/reset" when request.HttpMethod == "POST":
                await HandleConfigResetAsync(response, cancellationToken);
                return;
            case "/api/recovery" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _recoveryController.Get(), cancellationToken);
                return;
            case "/api/recovery/action" when request.HttpMethod == "POST":
                await HandleRecoveryActionAsync(request, response, cancellationToken);
                return;
            case "/api/config/backup" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _configController.BuildPortableBackup(), cancellationToken);
                return;
            case "/api/config/backup" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _configController.RestorePortableBackup(await ReadJsonAsync<PortableBackupRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/support/bundle" when request.HttpMethod == "GET":
                response.AddHeader("Content-Disposition", "attachment; filename=\"xenon-support-bundle.json\"");
                await WriteJsonAsync(response, 200, await _supportController.BuildSupportBundleAsync(dashboardUri, cancellationToken), cancellationToken);
                return;
            case "/api/releases/latest":
                await WriteJsonAsync(response, 200, await _releaseController.GetLatestAsync(GetQueryValue(request, "channel"), cancellationToken), cancellationToken);
                return;
            case "/api/releases/rollback" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _releaseController.BuildRollbackPayload(), cancellationToken);
                return;
            case "/api/scenes" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _sceneController.Get(), cancellationToken);
                return;
            case "/api/scenes" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _sceneController.Save(await ReadJsonAsync<SceneSaveRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/scenes/activate" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _sceneController.Activate(await ReadJsonAsync<SceneActivationRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/scenes/resume" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _sceneController.Resume(), cancellationToken);
                return;
            case "/api/scenes/duplicate" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _sceneController.Duplicate(await ReadJsonAsync<SceneDuplicateRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/scenes/delete" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _sceneController.Delete(await ReadJsonAsync<SceneDeleteRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/scenes/evaluate" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _sceneController.Evaluate(await ReadJsonAsync<SceneEvaluationRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/scenes/displays" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _sceneController.AssignDisplay(await ReadJsonAsync<DisplaySceneAssignmentRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/action-chains" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _actionChainController.Get(), cancellationToken);
                return;
            case "/api/action-chains/execute" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _actionChainController.Execute(await ReadJsonAsync<ActionChainExecuteRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/displays/controls" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _monitorControlController.Get(), cancellationToken);
                return;
            case "/api/displays/controls" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _monitorControlController.Set(await ReadJsonAsync<MonitorControlRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/extensions" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _extensionController.Get(), cancellationToken);
                return;
            case "/api/remote/session" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _remoteSessionController.Get(), cancellationToken);
                return;
            case "/api/remote/session" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _remoteSessionController.Start(), cancellationToken);
                return;
            case "/api/remote/session/stop" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _remoteSessionController.Stop(), cancellationToken);
                return;
            case "/api/config/weather" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _configController.UpdateWeather(await ReadJsonAsync<WeatherConfigRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/config/calendar" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _configController.UpdateCalendar(await ReadJsonAsync<CalendarConfigRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/config/network" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _configController.UpdateNetwork(await ReadJsonAsync<NetworkConfigRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/launchers" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _actionController.GetLaunchers(), cancellationToken);
                return;
            case "/api/launchers" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _actionController.UpdateLaunchers(await ReadJsonAsync<LaunchersUpdateRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/launchers/launch" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _actionController.Launch(await ReadJsonAsync<LauncherLaunchRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/launchers/icon" when request.HttpMethod == "GET":
                await HandleLauncherIconAsync(request, response, cancellationToken);
                return;
            case "/api/steam/games" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _gameController.GetSteamGames(IsTruthyQueryValue(request, "refresh")), cancellationToken);
                return;
            case "/api/steam/games/launch" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _gameController.LaunchSteamGame(await ReadJsonAsync<SteamGameLaunchRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/steam/games/art" when request.HttpMethod == "GET":
                await HandleSteamGameArtworkAsync(request, response, cancellationToken);
                return;
            case "/api/game/activity" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _gameController.GetActivity(IsTruthyQueryValue(request, "refresh")), cancellationToken);
                return;
            case "/api/game/session" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _gameController.GetSessionAsync(await ReadJsonAsync<GameModeSessionRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/game/performance" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _gameController.GetPerformance(), cancellationToken);
                return;
            case "/api/game/performance/session" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _gameController.EnsurePerformanceSession(), cancellationToken);
                return;
            case "/api/game/activity/pin" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _gameController.PinCandidate(await ReadJsonAsync<GameActivityPinRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/system":
                await WriteJsonAsync(response, 200, _telemetryController.GetSystemSnapshot(), cancellationToken);
                return;
            case "/api/system/restart-admin" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _actionController.RestartHostAsAdministrator(), cancellationToken);
                return;
            case "/api/action-confirmations" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _actionController.IssueActionConfirmation(await ReadJsonAsync<ActionConfirmationRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/gpu-power":
                await WriteJsonAsync(response, 200, _telemetryController.GetGpuPowerSnapshot(), cancellationToken);
                return;
            case "/api/network":
                await WriteJsonAsync(response, 200, _telemetryController.GetNetworkSnapshot(), cancellationToken);
                return;
            case "/api/unifi/network":
                await WriteJsonAsync(response, 200, await _telemetryController.GetUniFiNetworkAsync(cancellationToken), cancellationToken);
                return;
            case "/api/unifi/network/link" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _telemetryController.LinkUniFiAsync(await ReadJsonAsync<UniFiLinkRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/unifi/network/disconnect" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _telemetryController.DisconnectUniFi(), cancellationToken);
                return;
            case "/api/quick-actions" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _actionController.GetQuickActions(), cancellationToken);
                return;
            case "/api/system-shortcuts" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, _actionController.GetShortcuts(), cancellationToken);
                return;
            case "/api/system-shortcuts/brightness" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, _actionController.SetBrightness(await ReadJsonAsync<BrightnessRequest>(request, cancellationToken)), cancellationToken);
                return;
            case "/api/audio" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, await _telemetryController.GetAudioAsync(cancellationToken), cancellationToken);
                return;
            case "/api/audio/default-device" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _telemetryController.SetDefaultAudioDeviceAsync(await ReadJsonAsync<AudioDeviceRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/audio/master-volume" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _telemetryController.SetAudioMasterVolumeAsync(await ReadJsonAsync<AudioVolumeRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/audio/master-mute" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _telemetryController.SetAudioMasterMuteAsync(await ReadJsonAsync<AudioMuteRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/audio/input-volume" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _telemetryController.SetAudioInputVolumeAsync(await ReadJsonAsync<AudioVolumeRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/audio/input-mute" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _telemetryController.SetAudioInputMuteAsync(await ReadJsonAsync<AudioMuteRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/audio/session-volume" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _telemetryController.SetAudioSessionVolumeAsync(await ReadJsonAsync<AudioSessionVolumeRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/audio/session-mute" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _telemetryController.SetAudioSessionMuteAsync(await ReadJsonAsync<AudioSessionMuteRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/weather":
                await HandleWeatherRequestAsync(request, response, cancellationToken);
                return;
            case "/api/calendar":
                await WriteJsonAsync(response, 200, await _calendarService.GetSnapshotAsync(_configStore.Snapshot(), cancellationToken), cancellationToken);
                return;
            case "/api/media":
                await WriteJsonAsync(response, 200, await _actionController.GetMediaAsync(cancellationToken), cancellationToken);
                return;
            case "/api/media/play" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.ExecuteMediaAsync("play", cancellationToken), cancellationToken);
                return;
            case "/api/media/pause" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.ExecuteMediaAsync("pause", cancellationToken), cancellationToken);
                return;
            case "/api/media/play-pause" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.ExecuteMediaAsync("play-pause", cancellationToken), cancellationToken);
                return;
            case "/api/media/next" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.ExecuteMediaAsync("next", cancellationToken), cancellationToken);
                return;
            case "/api/media/previous" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.ExecuteMediaAsync("previous", cancellationToken), cancellationToken);
                return;
            case "/api/media/seek-back" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.ExecuteMediaAsync("seek-back", cancellationToken), cancellationToken);
                return;
            case "/api/media/seek-forward" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.ExecuteMediaAsync("seek-forward", cancellationToken), cancellationToken);
                return;
            case "/api/hue" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, await _actionController.GetHueAsync(cancellationToken), cancellationToken);
                return;
            case "/api/hue/link" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.LinkHueAsync(await ReadJsonAsync<HueLinkRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            case "/api/clipboard" when request.HttpMethod == "GET":
                await WriteJsonAsync(response, 200, await _actionController.GetClipboardAsync(cancellationToken), cancellationToken);
                return;
            case "/api/clipboard/copy" when request.HttpMethod == "POST":
                await WriteJsonAsync(response, 200, await _actionController.CopyClipboardAsync(await ReadJsonAsync<ClipboardCopyRequest>(request, cancellationToken), cancellationToken), cancellationToken);
                return;
            default:
                await HandleFallbackAsync(request, response, path, cancellationToken);
                return;
        }
    }

    private async Task HandleFallbackAsync(HttpListenerRequest request, HttpListenerResponse response, string path, CancellationToken cancellationToken)
    {
        if (_actionController.TryMatchQuickAction(path, request.HttpMethod, out var quickActionId))
        {
            var confirmation = await ReadJsonAsync<ActionConfirmationRequest>(request, cancellationToken);
            await WriteJsonAsync(response, 200, _actionController.ExecuteQuickAction(quickActionId, confirmation), cancellationToken);
            return;
        }

        if (_actionController.TryMatchSystemShortcut(path, request.HttpMethod, out var shortcutId))
        {
            var confirmation = await ReadJsonAsync<ActionConfirmationRequest>(request, cancellationToken);
            await WriteJsonAsync(response, 200, _actionController.ExecuteSystemShortcut(shortcutId, confirmation), cancellationToken);
            return;
        }

        var hueAction = await _actionController.TryExecuteHueActionAsync(
            path,
            request.HttpMethod,
            token => ReadJsonAsync<HueToggleRequest>(request, token),
            token => ReadJsonAsync<HueBrightnessRequest>(request, token),
            cancellationToken);
        if (hueAction.Handled)
        {
            await WriteJsonAsync(response, 200, hueAction.Payload!, cancellationToken);
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

        if (await _staticAssets.TryHandleAsync(path, response, cancellationToken))
        {
            return;
        }

        await WriteTextAsync(response, 404, "Not found", cancellationToken);
    }

    private async Task HandleConfigResetAsync(HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var receipt = await _localDataResetController.ResetAllAsync(cancellationToken);
        await WriteJsonAsync(response, receipt.Ok ? 200 : 500, receipt, cancellationToken);
    }

    private async Task HandleRecoveryActionAsync(
        HttpListenerRequest request,
        HttpListenerResponse response,
        CancellationToken cancellationToken)
    {
        var result = _recoveryController.Execute(await ReadJsonAsync<RecoveryActionRequest>(request, cancellationToken));
        await WriteJsonAsync(response, result.Ok ? 200 : 409, result, cancellationToken);
    }

    private async Task HandleLauncherIconAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var id = GetQueryValue(request, "id");
        if (!_actionController.TryGetLauncherIcon(id, out var asset))
        {
            await WriteTextAsync(response, 404, "Launcher icon not found", cancellationToken);
            return;
        }

        await WriteBinaryAsync(response, 200, asset.ContentType, asset.Content, cancellationToken);
    }

    private async Task HandleSteamGameArtworkAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var appId = GetQueryValue(request, "id");
        if (!_gameController.TryGetSteamArtwork(appId, out var asset))
        {
            await WriteTextAsync(response, 404, "Steam game artwork not found", cancellationToken);
            return;
        }

        await WriteBinaryAsync(response, 200, asset.ContentType, asset.Content, cancellationToken);
    }

    private async Task HandleWeatherRequestAsync(HttpListenerRequest request, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        var config = _configStore.Snapshot();
        var city = GetQueryValue(request, "city");
        var units = GetQueryValue(request, "units");
        try
        {
            var snapshot = await _weatherService.GetSnapshotAsync(config, city, units, cancellationToken);
            await WriteJsonAsync(response, 200, snapshot, cancellationToken);
        }
        catch (InvalidOperationException error)
        {
            await WriteJsonAsync(response, 502, new { error = error.Message }, cancellationToken);
        }
    }

    private static object BuildUnsupportedFeaturePayload(string status, string message)
    {
        return new Dictionary<string, object?>
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

        try
        {
            return JsonSerializer.Deserialize<T>(body, JsonOptions) ?? new T();
        }
        catch (JsonException error)
        {
            throw new InvalidJsonBodyException(error);
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

    private static async Task WriteTextAsync(HttpListenerResponse response, int statusCode, string text, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        response.StatusCode = statusCode;
        response.ContentType = "text/plain; charset=utf-8";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.ContentLength64 = bytes.LongLength;
        await response.OutputStream.WriteAsync(bytes, cancellationToken);
        response.Close();
    }

    private static async Task WriteBinaryAsync(HttpListenerResponse response, int statusCode, string contentType, byte[] content, CancellationToken cancellationToken)
    {
        response.StatusCode = statusCode;
        response.ContentType = contentType;
        response.Headers["Cache-Control"] = "public, max-age=604800";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.ContentLength64 = content.LongLength;
        await response.OutputStream.WriteAsync(content, cancellationToken);
        response.Close();
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
}

public sealed class RequestBodyTooLargeException : Exception
{
    public RequestBodyTooLargeException(int maxBytes)
        : base($"Request body must be {maxBytes} bytes or smaller.")
    {
    }
}

public sealed class InvalidJsonBodyException : Exception
{
    public InvalidJsonBodyException(JsonException innerException)
        : base(innerException.Message, innerException)
    {
    }
}
