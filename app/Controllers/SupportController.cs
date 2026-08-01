using System.Text.Json;
using System.Text.RegularExpressions;

namespace XenonEdgeHost;

public sealed class SupportController
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
    private static readonly Regex WindowsUserPathPattern = new(@"[A-Za-z]:\\Users\\[^\\\s""]+", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex MacUserPathPattern = new(@"/Users/[^/\s""]+", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex EmailPattern = new(@"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PrivateIpPattern = new(@"\b(?:(?:10)\.(?:\d{1,3}\.){2}\d{1,3}|(?:172)\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|(?:192\.168)\.\d{1,3}\.\d{1,3})\b", RegexOptions.Compiled);
    private static readonly Regex SensitiveQueryPattern = new(@"(?<name>(?:api[_-]?key|appid|token|secret|password|pass|sig|signature|auth|key))=[^&\s""]+", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly HostLogger _logger;
    private readonly ConfigStore _configStore;
    private readonly ConfigController _configController;
    private readonly TelemetryController _telemetryController;
    private readonly ProvisioningService _provisioningService;
    private readonly string _dashboardAssetRevision;

    public SupportController(
        HostLogger logger,
        ConfigStore configStore,
        ConfigController configController,
        TelemetryController telemetryController,
        ProvisioningService provisioningService,
        string dashboardAssetRevision)
    {
        _logger = logger;
        _configStore = configStore;
        _configController = configController;
        _telemetryController = telemetryController;
        _provisioningService = provisioningService;
        _dashboardAssetRevision = dashboardAssetRevision;
    }

    public async Task<object> BuildSupportBundleAsync(Uri dashboardUri, CancellationToken cancellationToken)
    {
        var config = _configStore.Snapshot();
        var health = await _telemetryController.BuildHealthPayloadAsync(cancellationToken);

        return new
        {
            generatedAt = DateTimeOffset.UtcNow,
            app = new
            {
                name = "Auxora",
                version = AppBuildIdentity.Version,
                dashboardAssetRevision = _dashboardAssetRevision,
                dashboardUrl = dashboardUri.ToString()
            },
            config = _configController.GetSupportSnapshot(config),
            health = SanitizeSupportObject(health, config),
            display = _configController.GetDisplayDiagnostics(config),
            releaseSafety = BuildSupportRollbackPayload(BuildRollbackPayload()),
            log = ReadRecentLogLines(120, config)
        };
    }

    public async Task<object> RunAutoRepairAsync(CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var actions = new List<object>();
        var config = _configStore.Snapshot();
        var display = _configController.GetDisplayDiagnostics(config);
        var companionDisplayReady = ConfigController.IsCompanionDisplayReady(display);
        var provisioning = _provisioningService.RunStartupProvisioning(forceLauncherScan: true);
        var health = await _telemetryController.BuildHealthPayloadAsync(cancellationToken);

        actions.Add(new
        {
            id = "config-normalized",
            state = "Ready",
            message = "Local config was loaded, normalized, and re-saved."
        });
        actions.Add(new
        {
            id = "display",
            state = string.Equals(display.Status, "ready", StringComparison.OrdinalIgnoreCase)
                && companionDisplayReady
                    ? "Ready"
                    : "Needs Setup",
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
            state = "Manual only",
            message = "Automatic rollback is not included in this beta. Keep the previous verified installer."
        });

        return new
        {
            ok = true,
            supported = true,
            status = companionDisplayReady ? "ready" : "needs-setup",
            sampledAt = startedAt,
            message = "Auto repair checked companion-display targeting, runtime health, launcher suggestions, and config state.",
            actions,
            health = SanitizeSupportObject(health, config)
        };
    }

    public RollbackPayload BuildRollbackPayload()
    {
        return new RollbackPayload
        {
            Supported = false,
            Configured = false,
            Status = "unavailable",
            Message = "Automatic rollback is not included in this beta. Keep the previous verified installer if you need to return to an earlier build."
        };
    }

    public string SanitizeText(string value, AppConfig? config = null)
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
            sanitized = ReplaceIfPresent(sanitized, config.Frigate.BaseUrl, "<frigate-endpoint>");
            sanitized = ReplaceIfPresent(sanitized, config.Frigate.Username, "<frigate-user>");
            sanitized = ReplaceIfPresent(sanitized, config.Frigate.Password, "<redacted>");

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

    private static object BuildSupportRollbackPayload(RollbackPayload rollback)
    {
        return new
        {
            supported = rollback.Supported,
            configured = rollback.Configured,
            status = rollback.Status,
            message = rollback.Message
        };
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
                .Select(line => SanitizeText(line, config))
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private object SanitizeSupportObject(object payload, AppConfig config)
    {
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        var sanitized = SanitizeText(json, config);
        var element = JsonSerializer.Deserialize<JsonElement>(sanitized, JsonOptions);
        return RedactClipboardEntries(element) ?? new { };
    }

    private static object? RedactClipboardEntries(JsonElement element, string? propertyName = null)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                return RedactClipboardObject(element, propertyName);
            case JsonValueKind.Array:
                return element.EnumerateArray()
                    .Select(item => RedactClipboardEntries(item))
                    .ToArray();
            case JsonValueKind.String:
                return element.GetString();
            case JsonValueKind.Number:
                return element.TryGetInt64(out var longValue)
                    ? longValue
                    : element.TryGetDouble(out var doubleValue)
                        ? doubleValue
                        : element.GetRawText();
            case JsonValueKind.True:
                return true;
            case JsonValueKind.False:
                return false;
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
            default:
                return null;
        }
    }

    private static object RedactClipboardObject(JsonElement element, string? propertyName)
    {
        var isClipboardPayload = string.Equals(propertyName, "clipboard", StringComparison.OrdinalIgnoreCase)
            || HasClipboardShape(element);
        var isAudioPayload = string.Equals(propertyName, "audio", StringComparison.OrdinalIgnoreCase)
            || HasSourceShape(element, "core audio");
        var isMediaPayload = string.Equals(propertyName, "media", StringComparison.OrdinalIgnoreCase)
            || HasSourceShape(element, "media session");
        var result = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        var entryCount = 0;
        var redactedEntries = false;
        var sessionCount = 0;

        foreach (var property in element.EnumerateObject())
        {
            if (isClipboardPayload
                && string.Equals(property.Name, "entries", StringComparison.OrdinalIgnoreCase))
            {
                entryCount = property.Value.ValueKind == JsonValueKind.Array
                    ? property.Value.GetArrayLength()
                    : 0;
                redactedEntries = true;
                continue;
            }

            if (isClipboardPayload
                && (string.Equals(property.Name, "preview", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(property.Name, "text", StringComparison.OrdinalIgnoreCase)))
            {
                redactedEntries = true;
                continue;
            }

            if (isAudioPayload
                && string.Equals(property.Name, "sessions", StringComparison.OrdinalIgnoreCase))
            {
                sessionCount = property.Value.ValueKind == JsonValueKind.Array
                    ? property.Value.GetArrayLength()
                    : 0;
                continue;
            }

            if (isMediaPayload
                && (string.Equals(property.Name, "title", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(property.Name, "artist", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(property.Name, "albumTitle", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(property.Name, "albumArtist", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(property.Name, "thumbnailDataUrl", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(property.Name, "appId", StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            result[property.Name] = RedactClipboardEntries(property.Value, property.Name);
        }

        if (isClipboardPayload)
        {
            result["entryCount"] = entryCount;
            result["entriesRedacted"] = true;
            result["previewsRedacted"] = true;
            if (redactedEntries)
            {
                result["diagnosticNote"] = "Clipboard entries and previews are excluded from support diagnostics.";
            }
        }

        if (isAudioPayload)
        {
            result["sessionCount"] = sessionCount;
            result["sessionsRedacted"] = true;
        }

        if (isMediaPayload)
        {
            result["metadataRedacted"] = true;
        }

        return result;
    }

    private static bool HasClipboardShape(JsonElement element)
    {
        return element.TryGetProperty("source", out var source)
            && source.ValueKind == JsonValueKind.String
            && (source.GetString() ?? "").Contains("clipboard", StringComparison.OrdinalIgnoreCase)
            && element.TryGetProperty("entries", out _);
    }

    private static bool HasSourceShape(JsonElement element, string sourceFragment)
    {
        return element.TryGetProperty("source", out var source)
            && source.ValueKind == JsonValueKind.String
            && (source.GetString() ?? "").Contains(sourceFragment, StringComparison.OrdinalIgnoreCase);
    }

    private static string ReplaceIfPresent(string source, string? value, string replacement)
    {
        return string.IsNullOrWhiteSpace(value)
            ? source
            : source.Replace(value, replacement, StringComparison.OrdinalIgnoreCase);
    }
}

public sealed class RollbackPayload
{
    public bool Supported { get; set; }

    public bool Configured { get; set; }

    public string Status { get; set; } = "";

    public string Message { get; set; } = "";
}
