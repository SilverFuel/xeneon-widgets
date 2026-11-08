using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class FrigateService
{
    private const int MaxEventsResponseBytes = 2 * 1024 * 1024;
    private const int MaxSnapshotResponseBytes = 8 * 1024 * 1024;
    private const int MaxAuthenticationResponseBytes = 64 * 1024;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan EventLookback = TimeSpan.FromHours(1);
    private static readonly TimeSpan MaximumFutureClockSkew = TimeSpan.FromMinutes(5);
    private static readonly HashSet<string> AllowedImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg",
        "image/png",
        "image/webp"
    };

    private readonly HttpClient _httpClient;
    private readonly HostLogger _logger;
    private readonly object _cacheSync = new();
    private readonly object _connectionSync = new();
    private readonly object _authenticationStateSync = new();
    private readonly object _sensitiveStateSync = new();
    private readonly SemaphoreSlim _authenticationLock = new(1, 1);
    private CancellationTokenSource _sensitiveStateCancellation = new();
    private string _cacheKey = "";
    private DateTimeOffset _cacheExpiresAt = DateTimeOffset.MinValue;
    private FrigateDetectionPayload? _cachedPayload;
    private string _authenticationKey = "";
    private string _bearerToken = "";
    private long _authenticationGeneration;
    private long _sensitiveStateGeneration;
    private string _connectionKey = "";
    private FrigateConnectionStatus _connectionStatus = FrigateConnectionStatus.Optional();

    public FrigateService(HttpClient httpClient, HostLogger logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<FrigateDetectionPayload> GetSnapshotAsync(
        AppConfig config,
        Uri localProxyBaseUri,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(localProxyBaseUri);

        if (string.IsNullOrWhiteSpace(config.Frigate.BaseUrl))
        {
            RecordConnectionStatus(config.Frigate, FrigateConnectionStatus.Optional());
            return CreateSetupPayload();
        }

        var sensitiveState = CaptureSensitiveState();
        var sensitiveStateGeneration = sensitiveState.Generation;
        using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            sensitiveState.CancellationToken);
        try
        {
            var payload = await GetSnapshotCoreAsync(
                config,
                localProxyBaseUri,
                sensitiveStateGeneration,
                linkedCancellation.Token);
            EnsureSensitiveStateGeneration(sensitiveStateGeneration);
            RecordConnectionStatus(config.Frigate, FrigateConnectionStatus.Ready(
                HasCredentials(config.Frigate),
                "Frigate accepted the connection and recent-event request."));
            return payload;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException error) when (sensitiveStateGeneration != Volatile.Read(ref _sensitiveStateGeneration))
        {
            throw CreateSensitiveStateChangedException(error);
        }
        catch (Exception error)
        {
            var message = error is InvalidOperationException
                ? error.Message
                : "Frigate could not be reached.";
            if (sensitiveStateGeneration == Volatile.Read(ref _sensitiveStateGeneration))
            {
                RecordConnectionStatus(
                    config.Frigate,
                    FrigateConnectionStatus.Failed(HasCredentials(config.Frigate), message));
            }
            if (error is InvalidOperationException)
            {
                throw;
            }

            throw new InvalidOperationException(message, error);
        }
    }

    private async Task<FrigateDetectionPayload> GetSnapshotCoreAsync(
        AppConfig config,
        Uri localProxyBaseUri,
        long sensitiveStateGeneration,
        CancellationToken cancellationToken)
    {

        var upstreamBaseUri = new Uri(
            NetworkEndpointGuard.NormalizeLocalHttpBaseUrl(config.Frigate.BaseUrl, "Frigate address"),
            UriKind.Absolute);
        var camera = ConfigStore.NormalizeFrigateCamera(config.Frigate.Camera);
        var cacheKey = $"{BuildAuthenticationKey(config.Frigate, upstreamBaseUri)}|{camera}|{localProxyBaseUri.GetLeftPart(UriPartial.Authority)}";
        lock (_cacheSync)
        {
            if (string.Equals(_cacheKey, cacheKey, StringComparison.Ordinal)
                && _cachedPayload is not null
                && _cacheExpiresAt > DateTimeOffset.UtcNow)
            {
                return ClonePayload(_cachedPayload);
            }
        }

        var eventsUri = BuildEventsUri(upstreamBaseUri, camera);
        using var response = await SendFrigateGetAsync(
            config.Frigate,
            upstreamBaseUri,
            eventsUri,
            MaxEventsResponseBytes,
            sensitiveStateGeneration,
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Frigate events request failed with HTTP {(int)response.StatusCode}.");
        }

        var raw = await response.Content.ReadAsStringAsync(cancellationToken);
        FrigateDetectionPayload payload;
        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidOperationException("Frigate returned an invalid events payload.");
            }

            var sampledAt = DateTimeOffset.UtcNow;
            var earliestEventTime = sampledAt.Subtract(EventLookback);
            var latestEventTime = sampledAt.Add(MaximumFutureClockSkew);
            var alerts = document.RootElement
                .EnumerateArray()
                .Select(ParseEvent)
                .Where(entry => entry is not null)
                .Cast<FrigateDetectionEvent>()
                .Where(entry => entry.Time >= earliestEventTime && entry.Time <= latestEventTime)
                .Where(entry => string.IsNullOrWhiteSpace(camera)
                    || entry.Camera.Equals(camera, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(entry => entry.Time)
                .Take(24)
                .ToList();
            var latest = alerts.FirstOrDefault();
            var snapshotUrl = latest is not null && latest.HasSnapshot
                ? new Uri(localProxyBaseUri, $"api/frigate/snapshot?id={Uri.EscapeDataString(latest.Id)}").ToString()
                : "";
            payload = new FrigateDetectionPayload
            {
                Supported = true,
                Configured = true,
                Status = "live",
                Source = "Frigate",
                Message = alerts.Count == 0
                    ? "No object detections were reported in the last hour."
                    : $"{alerts.Count} object detection{(alerts.Count == 1 ? "" : "s")} reported in the last hour.",
                Camera = string.IsNullOrWhiteSpace(camera) ? latest?.Camera ?? "All cameras" : camera,
                SnapshotUrl = snapshotUrl,
                Alerts = alerts,
                LastDetection = latest,
                Counts = new FrigateDetectionCounts
                {
                    LastHour = alerts.Count,
                    ActiveCameras = alerts.Select(entry => entry.Camera).Distinct(StringComparer.OrdinalIgnoreCase).Count()
                },
                SampledAt = sampledAt,
                Stale = false
            };
        }
        catch (JsonException error)
        {
            throw new InvalidOperationException("Frigate returned invalid JSON.", error);
        }

        if (sensitiveStateGeneration == Volatile.Read(ref _sensitiveStateGeneration))
        {
            lock (_cacheSync)
            {
                if (sensitiveStateGeneration == Volatile.Read(ref _sensitiveStateGeneration))
                {
                    _cacheKey = cacheKey;
                    _cacheExpiresAt = DateTimeOffset.UtcNow.Add(CacheTtl);
                    _cachedPayload = ClonePayload(payload);
                }
            }
        }

        return payload;
    }

    public async Task<FrigateConnectionStatus> TestConnectionAsync(
        AppConfig config,
        Uri localProxyBaseUri,
        CancellationToken cancellationToken)
    {
        lock (_cacheSync)
        {
            _cacheKey = "";
            _cacheExpiresAt = DateTimeOffset.MinValue;
            _cachedPayload = null;
        }

        try
        {
            await GetSnapshotAsync(config, localProxyBaseUri, cancellationToken);
        }
        catch (InvalidOperationException)
        {
            // Connection state carries the safe, user-facing failure without discarding saved settings.
        }

        return GetConnectionStatus(config);
    }

    public FrigateConnectionStatus GetConnectionStatus(AppConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        if (string.IsNullOrWhiteSpace(config.Frigate.BaseUrl))
        {
            return FrigateConnectionStatus.Optional();
        }

        var expectedKey = BuildConnectionKey(config.Frigate);
        lock (_connectionSync)
        {
            return string.Equals(_connectionKey, expectedKey, StringComparison.Ordinal)
                ? _connectionStatus.Clone()
                : FrigateConnectionStatus.Untested(HasCredentials(config.Frigate));
        }
    }

    public void ClearSensitiveState()
    {
        CancellationTokenSource priorCancellation;
        lock (_sensitiveStateSync)
        {
            Interlocked.Increment(ref _sensitiveStateGeneration);
            priorCancellation = _sensitiveStateCancellation;
            _sensitiveStateCancellation = new CancellationTokenSource();
        }

        lock (_authenticationStateSync)
        {
            _authenticationKey = "";
            _bearerToken = "";
            _authenticationGeneration++;
        }

        _ = CancelAndDisposeAsync(priorCancellation);

        lock (_cacheSync)
        {
            _cacheKey = "";
            _cacheExpiresAt = DateTimeOffset.MinValue;
            _cachedPayload = null;
        }

        lock (_connectionSync)
        {
            _connectionKey = "";
            _connectionStatus = FrigateConnectionStatus.Optional();
        }
    }

    private (long Generation, CancellationToken CancellationToken) CaptureSensitiveState()
    {
        lock (_sensitiveStateSync)
        {
            return (_sensitiveStateGeneration, _sensitiveStateCancellation.Token);
        }
    }

    private static async Task CancelAndDisposeAsync(CancellationTokenSource cancellation)
    {
        try
        {
            await cancellation.CancelAsync();
        }
        catch
        {
            // Cancellation is best-effort; generation checks still reject every stale result.
        }
        finally
        {
            cancellation.Dispose();
        }
    }

    private void EnsureSensitiveStateGeneration(long expectedGeneration)
    {
        if (expectedGeneration != Volatile.Read(ref _sensitiveStateGeneration))
        {
            throw new InvalidOperationException("Camera Detection settings changed during the request. Refresh to use the current configuration.");
        }
    }

    private static InvalidOperationException CreateSensitiveStateChangedException(Exception? inner = null)
    {
        const string message = "Camera Detection settings changed during the request. Refresh to use the current configuration.";
        return inner is null ? new InvalidOperationException(message) : new InvalidOperationException(message, inner);
    }

    private void RecordConnectionStatus(FrigateConfig config, FrigateConnectionStatus status)
    {
        lock (_connectionSync)
        {
            _connectionKey = string.IsNullOrWhiteSpace(config.BaseUrl) ? "" : BuildConnectionKey(config);
            _connectionStatus = status.Clone();
        }
    }

    public async Task<FrigateImageAsset> GetEventSnapshotAsync(
        AppConfig config,
        Uri localProxyBaseUri,
        string? eventId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(localProxyBaseUri);
        if (string.IsNullOrWhiteSpace(config.Frigate.BaseUrl))
        {
            throw new FrigateSnapshotUnavailableException("Frigate is not configured.");
        }

        var sensitiveState = CaptureSensitiveState();
        using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            sensitiveState.CancellationToken);
        try
        {
            var normalizedEventId = NormalizeEventId(eventId);
            var current = await GetSnapshotCoreAsync(
                config,
                localProxyBaseUri,
                sensitiveState.Generation,
                linkedCancellation.Token);
            EnsureSensitiveStateGeneration(sensitiveState.Generation);
            if (!current.Alerts.Any(entry => entry.HasSnapshot
                && entry.Id.Equals(normalizedEventId, StringComparison.Ordinal)))
            {
                throw new FrigateSnapshotUnavailableException(
                    "The requested snapshot is not in the current filtered Camera Detection results.");
            }

            var upstreamBaseUri = new Uri(
                NetworkEndpointGuard.NormalizeLocalHttpBaseUrl(config.Frigate.BaseUrl, "Frigate address"),
                UriKind.Absolute);
            var snapshotUri = new Uri(upstreamBaseUri, $"api/events/{Uri.EscapeDataString(normalizedEventId)}/snapshot.jpg");
            using var response = await SendFrigateGetAsync(
                config.Frigate,
                upstreamBaseUri,
                snapshotUri,
                MaxSnapshotResponseBytes,
                sensitiveState.Generation,
                linkedCancellation.Token);
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Frigate snapshot request failed with HTTP {(int)response.StatusCode}.");
            }

            var contentType = response.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
            if (!AllowedImageTypes.Contains(contentType))
            {
                throw new InvalidOperationException("Frigate snapshot response was not a supported image type.");
            }

            var content = await response.Content.ReadAsByteArrayAsync(linkedCancellation.Token);
            EnsureSensitiveStateGeneration(sensitiveState.Generation);
            return new FrigateImageAsset(contentType, content);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException error) when (sensitiveState.Generation != Volatile.Read(ref _sensitiveStateGeneration))
        {
            throw CreateSensitiveStateChangedException(error);
        }
        catch (Exception error) when (error is not InvalidOperationException)
        {
            throw new InvalidOperationException("Frigate could not be reached.", error);
        }
    }

    internal static string NormalizeEventId(string? eventId)
    {
        var value = eventId?.Trim() ?? "";
        if (!IsValidEventId(value))
        {
            throw new FrigateSnapshotUnavailableException("Frigate event ID is invalid.");
        }

        return value;
    }

    private static bool IsValidEventId(string value)
    {
        return value.Length is >= 1 and <= 160
            && value.All(ch => char.IsLetterOrDigit(ch) || ch is '.' or '_' or '-');
    }

    private async Task<HttpResponseMessage> SendFrigateGetAsync(
        FrigateConfig config,
        Uri upstreamBaseUri,
        Uri requestUri,
        int maxResponseBytes,
        long sensitiveStateGeneration,
        CancellationToken cancellationToken)
    {
        EnsureSensitiveStateGeneration(sensitiveStateGeneration);
        var authentication = await EnsureAuthenticatedAsync(
            config,
            upstreamBaseUri,
            force: false,
            rejectedGeneration: -1,
            sensitiveStateGeneration,
            cancellationToken);
        var response = await SendGetAsync(
            requestUri,
            authentication.BearerToken,
            maxResponseBytes,
            cancellationToken);
        try
        {
            EnsureSensitiveStateGeneration(sensitiveStateGeneration);
        }
        catch
        {
            response.Dispose();
            throw;
        }
        if (response.StatusCode != HttpStatusCode.Unauthorized || !HasCredentials(config))
        {
            return response;
        }

        response.Dispose();
        authentication = await EnsureAuthenticatedAsync(
            config,
            upstreamBaseUri,
            force: true,
            rejectedGeneration: authentication.Generation,
            sensitiveStateGeneration,
            cancellationToken);
        response = await SendGetAsync(
            requestUri,
            authentication.BearerToken,
            maxResponseBytes,
            cancellationToken);
        try
        {
            EnsureSensitiveStateGeneration(sensitiveStateGeneration);
            return response;
        }
        catch
        {
            response.Dispose();
            throw;
        }
    }

    private ValueTask<HttpResponseMessage> SendGetAsync(
        Uri requestUri,
        string bearerToken,
        int maxResponseBytes,
        CancellationToken cancellationToken)
    {
        return HttpReadResilience.SendAsync(
            _httpClient,
            () =>
            {
                var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
                if (!string.IsNullOrWhiteSpace(bearerToken))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
                }

                return request;
            },
            maxResponseBytes,
            cancellationToken);
    }

    private async Task<(string BearerToken, long Generation)> EnsureAuthenticatedAsync(
        FrigateConfig config,
        Uri upstreamBaseUri,
        bool force,
        long rejectedGeneration,
        long sensitiveStateGeneration,
        CancellationToken cancellationToken)
    {
        EnsureSensitiveStateGeneration(sensitiveStateGeneration);
        var username = ConfigStore.NormalizeFrigateUsername(config.Username);
        var password = config.Password?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(username) && string.IsNullOrWhiteSpace(password))
        {
            return ("", 0);
        }

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            throw new InvalidOperationException("Frigate authentication is incomplete. Re-enter the username and password in Diagnostics.");
        }

        ValidateAuthenticationTransport(upstreamBaseUri, username, password);

        var authenticationKey = BuildAuthenticationKey(config, upstreamBaseUri);
        await _authenticationLock.WaitAsync(cancellationToken);
        try
        {
            EnsureSensitiveStateGeneration(sensitiveStateGeneration);
            lock (_authenticationStateSync)
            {
                if (string.Equals(_authenticationKey, authenticationKey, StringComparison.Ordinal)
                    && (!force || _authenticationGeneration != rejectedGeneration))
                {
                    return (_bearerToken, _authenticationGeneration);
                }
            }

            var loginUri = new Uri(upstreamBaseUri, "api/login");
            var loginJson = JsonSerializer.Serialize(new { user = username, password });
            using var response = await HttpReadResilience.SendAsync(
                _httpClient,
                () => new HttpRequestMessage(HttpMethod.Post, loginUri)
                {
                    Content = new StringContent(loginJson, Encoding.UTF8, "application/json")
                },
                MaxAuthenticationResponseBytes,
                cancellationToken,
                HttpReadResilience.CreatePipeline(maxRetryAttempts: 0));
            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                throw new InvalidOperationException("Frigate rejected the configured username or password.");
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Frigate authentication failed with HTTP {(int)response.StatusCode}.");
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            var bearerToken = ExtractBearerToken(response, body);
            if (string.IsNullOrWhiteSpace(bearerToken))
            {
                throw new InvalidOperationException("Frigate authentication succeeded without returning a usable token.");
            }

            EnsureSensitiveStateGeneration(sensitiveStateGeneration);
            long authenticationGeneration;
            lock (_authenticationStateSync)
            {
                EnsureSensitiveStateGeneration(sensitiveStateGeneration);
                _bearerToken = bearerToken;
                _authenticationKey = authenticationKey;
                _authenticationGeneration++;
                authenticationGeneration = _authenticationGeneration;
            }
            _logger.Info("Authenticated to the configured local Frigate API.");
            return (bearerToken, authenticationGeneration);
        }
        finally
        {
            _authenticationLock.Release();
        }
    }

    private static bool HasCredentials(FrigateConfig config)
    {
        return !string.IsNullOrWhiteSpace(config.Username) && !string.IsNullOrWhiteSpace(config.Password);
    }

    internal static void ValidateAuthenticationTransport(Uri upstreamBaseUri, string username, string password)
    {
        if (string.IsNullOrWhiteSpace(username) && string.IsNullOrWhiteSpace(password))
        {
            return;
        }

        var loopback = upstreamBaseUri.IsLoopback
            || upstreamBaseUri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || upstreamBaseUri.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase);
        if (!upstreamBaseUri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) && !loopback)
        {
            throw new InvalidOperationException("Authenticated Frigate connections require HTTPS so credentials are not exposed on the local network.");
        }
    }

    private static string BuildAuthenticationKey(FrigateConfig config, Uri upstreamBaseUri)
    {
        var identity = $"{upstreamBaseUri}|{ConfigStore.NormalizeFrigateUsername(config.Username)}|{config.Password?.Trim() ?? ""}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
    }

    private static string BuildConnectionKey(FrigateConfig config)
    {
        var baseUri = new Uri(
            NetworkEndpointGuard.NormalizeLocalHttpBaseUrl(config.BaseUrl, "Frigate address"),
            UriKind.Absolute);
        return $"{BuildAuthenticationKey(config, baseUri)}|{ConfigStore.NormalizeFrigateCamera(config.Camera)}";
    }

    private static string ExtractBearerToken(HttpResponseMessage response, string body)
    {
        if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
        {
            foreach (var cookie in cookies)
            {
                var nameValue = cookie.Split(';', 2)[0].Split('=', 2);
                if (nameValue.Length == 2
                    && (nameValue[0].Trim().Equals("frigate_token", StringComparison.OrdinalIgnoreCase)
                        || nameValue[0].Trim().Equals("frigate-token", StringComparison.OrdinalIgnoreCase)))
                {
                    return Uri.UnescapeDataString(nameValue[1].Trim());
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(body))
        {
            try
            {
                using var document = JsonDocument.Parse(body);
                if (document.RootElement.ValueKind == JsonValueKind.Object)
                {
                    foreach (var propertyName in new[] { "access_token", "token", "jwt" })
                    {
                        if (document.RootElement.TryGetProperty(propertyName, out var value)
                            && value.ValueKind == JsonValueKind.String)
                        {
                            return value.GetString()?.Trim() ?? "";
                        }
                    }
                }
            }
            catch (JsonException)
            {
                // A successful login may communicate authentication only through the handler's cookie container.
            }
        }

        return "";
    }

    private static Uri BuildEventsUri(Uri baseUri, string camera)
    {
        var after = DateTimeOffset.UtcNow.AddHours(-1).ToUnixTimeSeconds();
        var query = $"limit=24&has_snapshot=1&after={after.ToString(CultureInfo.InvariantCulture)}";
        if (!string.IsNullOrWhiteSpace(camera))
        {
            query += $"&camera={Uri.EscapeDataString(camera)}";
        }

        return new Uri(baseUri, $"api/events?{query}");
    }

    private static FrigateDetectionEvent? ParseEvent(JsonElement entry)
    {
        if (entry.ValueKind != JsonValueKind.Object
            || ReadBoolean(entry, "false_positive") == true)
        {
            return null;
        }

        var id = ReadString(entry, "id");
        var camera = ReadString(entry, "camera");
        var label = ReadString(entry, "label");
        var startTime = ReadDouble(entry, "start_time");
        if (string.IsNullOrWhiteSpace(id)
            || !IsValidEventId(id)
            || string.IsNullOrWhiteSpace(camera)
            || string.IsNullOrWhiteSpace(label)
            || startTime is null)
        {
            return null;
        }

        var eventTime = ParseUnixSeconds(startTime.Value);
        if (eventTime is null)
        {
            return null;
        }

        var score = 0d;
        if (entry.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
        {
            score = ReadDouble(data, "score") ?? ReadDouble(data, "top_score") ?? 0d;
        }

        var zone = "No zone";
        if (entry.TryGetProperty("zones", out var zones) && zones.ValueKind == JsonValueKind.Array)
        {
            zone = zones.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString())
                .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? zone;
        }

        return new FrigateDetectionEvent
        {
            Id = id,
            Label = label,
            Camera = camera,
            Zone = zone,
            Time = eventTime.Value,
            Score = Math.Clamp(score, 0d, 1d),
            InProgress = !entry.TryGetProperty("end_time", out var endTime) || endTime.ValueKind == JsonValueKind.Null,
            HasSnapshot = ReadBoolean(entry, "has_snapshot") == true
        };
    }

    private static string ReadString(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var node) && node.ValueKind == JsonValueKind.String
            ? node.GetString()?.Trim() ?? ""
            : "";
    }

    private static double? ReadDouble(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var node))
        {
            return null;
        }

        if (node.ValueKind == JsonValueKind.Number && node.TryGetDouble(out var number))
        {
            return number;
        }

        return node.ValueKind == JsonValueKind.String
            && double.TryParse(node.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : null;
    }

    private static DateTimeOffset? ParseUnixSeconds(double value)
    {
        if (!double.IsFinite(value))
        {
            return null;
        }

        var milliseconds = value * 1000d;
        if (milliseconds < DateTimeOffset.MinValue.ToUnixTimeMilliseconds()
            || milliseconds > DateTimeOffset.MaxValue.ToUnixTimeMilliseconds())
        {
            return null;
        }

        return DateTimeOffset.FromUnixTimeMilliseconds((long)Math.Round(milliseconds));
    }

    private static bool? ReadBoolean(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var node))
        {
            return null;
        }

        return node.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };
    }

    private static FrigateDetectionPayload CreateSetupPayload()
    {
        return new FrigateDetectionPayload
        {
            Supported = true,
            Configured = false,
            Status = "setup",
            Source = "Frigate",
            Message = "Add a local Frigate address in Diagnostics to enable Camera Detection."
        };
    }

    private static FrigateDetectionPayload ClonePayload(FrigateDetectionPayload payload)
    {
        return JsonSerializer.Deserialize<FrigateDetectionPayload>(JsonSerializer.Serialize(payload))
            ?? CreateSetupPayload();
    }
}

public sealed class FrigateSnapshotUnavailableException : InvalidOperationException
{
    public FrigateSnapshotUnavailableException(string message)
        : base(message)
    {
    }
}

public sealed class FrigateDetectionPayload
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "setup";

    public string Source { get; set; } = "Frigate";

    public string Message { get; set; } = "";

    public string Camera { get; set; } = "All cameras";

    public string SnapshotUrl { get; set; } = "";

    public List<FrigateDetectionEvent> Alerts { get; set; } = [];

    public FrigateDetectionEvent? LastDetection { get; set; }

    public FrigateDetectionCounts Counts { get; set; } = new();

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }
}

public sealed class FrigateDetectionEvent
{
    public string Id { get; set; } = "";

    public string Label { get; set; } = "Object";

    public string Camera { get; set; } = "Camera";

    public string Zone { get; set; } = "No zone";

    public DateTimeOffset Time { get; set; }

    public double Score { get; set; }

    public bool InProgress { get; set; }

    public bool HasSnapshot { get; set; }
}

public sealed class FrigateDetectionCounts
{
    public int LastHour { get; set; }

    public int ActiveCameras { get; set; }
}

public sealed record FrigateImageAsset(string ContentType, byte[] Content);

public sealed class FrigateConnectionStatus
{
    public bool Configured { get; set; }

    public bool Connected { get; set; }

    public bool Authenticated { get; set; }

    public string State { get; set; } = "Optional";

    public string Message { get; set; } = "Camera Detection is optional until a local Frigate address is saved.";

    public DateTimeOffset? SampledAt { get; set; }

    public static FrigateConnectionStatus Optional() => new();

    public static FrigateConnectionStatus Untested(bool authenticated) => new()
    {
        Configured = true,
        Authenticated = authenticated,
        State = "Configured",
        Message = "Frigate settings are saved but the connection has not been tested yet."
    };

    public static FrigateConnectionStatus Ready(bool authenticated, string message) => new()
    {
        Configured = true,
        Connected = true,
        Authenticated = authenticated,
        State = "Ready",
        Message = message,
        SampledAt = DateTimeOffset.UtcNow
    };

    public static FrigateConnectionStatus Failed(bool authenticated, string message) => new()
    {
        Configured = true,
        Authenticated = authenticated,
        State = "Needs Setup",
        Message = message,
        SampledAt = DateTimeOffset.UtcNow
    };

    public FrigateConnectionStatus Clone() => new()
    {
        Configured = Configured,
        Connected = Connected,
        Authenticated = Authenticated,
        State = State,
        Message = Message,
        SampledAt = SampledAt
    };
}
