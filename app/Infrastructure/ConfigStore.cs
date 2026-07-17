using System.Text.Json;

namespace XenonEdgeHost;

public sealed class ConfigStore
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private readonly string _configPath;
    private readonly object _sync = new();
    private readonly HostLogger _logger;
    private readonly SecretStore _secretStore;

    public ConfigStore(HostLogger logger)
        : this(logger, null)
    {
    }

    internal ConfigStore(HostLogger logger, string? configDirectoryOverride)
    {
        _logger = logger;
        var configDirectory = string.IsNullOrWhiteSpace(configDirectoryOverride)
            ? AppPaths.RoamingDataDirectory
            : configDirectoryOverride;
        Directory.CreateDirectory(configDirectory);

        _secretStore = new SecretStore(configDirectory, logger);
        _configPath = Path.Combine(configDirectory, "config.json");
        Current = Load();
        Save(Current);
        _logger.Info($"Auxora settings are stored in {configDirectory}. Legacy XENEON data remains available for rollback.");
    }

    public AppConfig Current { get; private set; }

    public AppConfig Snapshot()
    {
        lock (_sync)
        {
            return Clone(Current);
        }
    }

    public AppConfig Update(Func<AppConfig, AppConfig> updater)
    {
        lock (_sync)
        {
            var next = Normalize(updater(Clone(Current)));
            Save(next);
            Current = next;
            return Clone(next);
        }
    }

    public AppConfig ResetLocalData(bool keepPort = true)
    {
        lock (_sync)
        {
            var port = keepPort ? Current.Port : 8976;
            _secretStore.Clear();
            var next = Normalize(new AppConfig
            {
                Port = port
            });
            Save(next);
            Current = next;
            _logger.Info("Local dashboard config and protected secrets were reset.");
            return Clone(Current);
        }
    }

    private AppConfig Load()
    {
        try
        {
            if (!File.Exists(_configPath))
            {
                var newConfig = new AppConfig();
                ApplyProtectedSecrets(newConfig);
                return Normalize(newConfig);
            }

            var json = File.ReadAllText(_configPath);
            var config = Normalize(JsonSerializer.Deserialize<AppConfig>(json, SerializerOptions) ?? new AppConfig());
            MigratePlainTextSecrets(config);
            ApplyProtectedSecrets(config);
            return Normalize(config);
        }
        catch (Exception error)
        {
            _logger.Error("Failed to load config. Falling back to defaults.", error);
            var config = new AppConfig();
            ApplyProtectedSecrets(config);
            return Normalize(config);
        }
    }

    private void Save(AppConfig config)
    {
        try
        {
            SaveProtectedSecrets(config);
            var diskConfig = Clone(config);
            RemoveSecretsFromDiskConfig(diskConfig);
            AtomicFile.WriteAllText(_configPath, JsonSerializer.Serialize(diskConfig, SerializerOptions));
        }
        catch (Exception error)
        {
            _logger.Error("Failed to save config.", error);
            throw new InvalidOperationException("Unable to save local dashboard settings.", error);
        }
    }

    private static AppConfig Clone(AppConfig config)
    {
        return JsonSerializer.Deserialize<AppConfig>(
                   JsonSerializer.Serialize(config, SerializerOptions),
                   SerializerOptions)
               ?? new AppConfig();
    }

    private static AppConfig Normalize(AppConfig? config)
    {
        var normalized = config ?? new AppConfig();
        normalized.Port = normalized.Port <= 0 ? 8976 : normalized.Port;
        normalized.Weather ??= new WeatherConfig();
        normalized.Calendar ??= new CalendarConfig();
        normalized.Hue ??= new HueConfig();
        normalized.UniFi ??= new UniFiConfig();
        normalized.Network ??= new NetworkConfig();
        normalized.Dashboard ??= new DashboardConfig();
        normalized.Scenes = SceneDefaults.Normalize(normalized.Scenes);
        normalized.Launchers ??= [];
        normalized.Weather.City = normalized.Weather.City?.Trim() ?? "";
        normalized.Weather.Units = string.Equals(normalized.Weather.Units, "imperial", StringComparison.OrdinalIgnoreCase)
            ? "imperial"
            : "metric";
        normalized.UniFi.Host = NormalizeHost(normalized.UniFi.Host);
        normalized.Hue.CertificateThumbprint = NormalizeThumbprint(normalized.Hue.CertificateThumbprint);
        normalized.UniFi.Username = normalized.UniFi.Username?.Trim() ?? "";
        normalized.UniFi.Site = NormalizeSite(normalized.UniFi.Site);
        normalized.UniFi.CertificateThumbprint = NormalizeThumbprint(normalized.UniFi.CertificateThumbprint);
        normalized.Network.HealthTarget = NormalizePingTarget(normalized.Network.HealthTarget);
        normalized.Dashboard.AutoProvisioningVersion = normalized.Dashboard.AutoProvisioningVersion <= 0 ? 1 : normalized.Dashboard.AutoProvisioningVersion;
        normalized.Dashboard.OnboardingVersion = normalized.Dashboard.OnboardingVersion <= 0 ? 1 : normalized.Dashboard.OnboardingVersion;
        normalized.Dashboard.PreferredDisplayId = normalized.Dashboard.PreferredDisplayId?.Trim() ?? "";
        normalized.Dashboard.PreferredDisplayDeviceName = normalized.Dashboard.PreferredDisplayDeviceName?.Trim() ?? "";
        normalized.Dashboard.DisplaySelectedAt = normalized.Dashboard.DisplaySelectedAt?.Trim() ?? "";
        normalized.Dashboard.PerformanceBudget = NormalizeChoice(normalized.Dashboard.PerformanceBudget, "balanced", "balanced", "battery", "game", "max");
        normalized.Dashboard.ThemeReadability = NormalizeChoice(normalized.Dashboard.ThemeReadability, "normal", "normal", "clean", "high-contrast", "visor");
        normalized.Dashboard.ReleaseChannel = NormalizeChoice(normalized.Dashboard.ReleaseChannel, "stable", "stable", "beta", "nightly");
        normalized.Dashboard.LastKnownGoodVersion = normalized.Dashboard.LastKnownGoodVersion?.Trim() ?? "";
        normalized.Dashboard.LastKnownGoodPath = normalized.Dashboard.LastKnownGoodPath?.Trim() ?? "";
        var normalizedLaunchers = NormalizeLaunchers(normalized.Launchers);
        var migratedGamePins = normalizedLaunchers.Where(IsGamePin).ToList();
        normalized.Launchers = normalizedLaunchers.Where(entry => !IsGamePin(entry)).ToList();
        normalized.PinnedGames = NormalizeLaunchers((normalized.PinnedGames ?? []).Concat(migratedGamePins))
            .GroupBy(entry => NormalizePathKey(entry.ExecutablePath), StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
        return normalized;
    }

    private static string NormalizeChoice(string? value, string fallback, params string[] allowed)
    {
        var normalized = value?.Trim().ToLowerInvariant() ?? "";
        return allowed.Contains(normalized, StringComparer.OrdinalIgnoreCase) ? normalized : fallback;
    }

    private static string NormalizeHost(string? input)
    {
        try
        {
            return NetworkEndpointGuard.NormalizeLocalHttpsAuthority(input, "UniFi console");
        }
        catch (InvalidOperationException)
        {
            return "";
        }
    }

    private static string NormalizeSite(string? input)
    {
        var trimmed = input?.Trim() ?? "";
        return string.IsNullOrWhiteSpace(trimmed) ? "default" : trimmed;
    }

    private static string NormalizePingTarget(string? input)
    {
        var value = input?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        if (value.Length > 120)
        {
            return "";
        }

        return value.All(ch => char.IsLetterOrDigit(ch) || ch is '.' or '-' or ':')
            ? value
            : "";
    }

    private static string NormalizeThumbprint(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return "";
        }

        var chars = input
            .Where(Uri.IsHexDigit)
            .Select(char.ToUpperInvariant)
            .ToArray();
        return new string(chars);
    }

    private static string NormalizeLauncherDisplayName(string executablePath, string? displayName)
    {
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            return displayName.Trim();
        }

        var trimmedPath = executablePath?.Trim() ?? "";
        if (Uri.TryCreate(trimmedPath, UriKind.Absolute, out var uri) && !uri.IsFile)
        {
            return string.IsNullOrWhiteSpace(uri.Host) ? trimmedPath : uri.Host;
        }

        var fileName = Path.GetFileNameWithoutExtension(trimmedPath);
        return string.IsNullOrWhiteSpace(fileName) ? trimmedPath : fileName;
    }

    private static List<LauncherEntryConfig> NormalizeLaunchers(IEnumerable<LauncherEntryConfig>? launchers)
    {
        var normalized = new List<LauncherEntryConfig>();
        foreach (var entry in launchers ?? [])
        {
            if (!LauncherTargetValidator.TryValidateAndNormalizeTarget(
                    entry.ExecutablePath,
                    entry.Arguments,
                    out var target))
            {
                continue;
            }

            normalized.Add(new LauncherEntryConfig
            {
                Id = string.IsNullOrWhiteSpace(entry.Id) ? Guid.NewGuid().ToString("N") : entry.Id.Trim(),
                DisplayName = NormalizeLauncherDisplayName(target.Target, entry.DisplayName),
                IconPath = entry.IconPath?.Trim() ?? "",
                ExecutablePath = target.Target,
                Arguments = target.Arguments
            });
        }

        return normalized;
    }

    private static bool IsGamePin(LauncherEntryConfig entry)
    {
        return !string.IsNullOrWhiteSpace(entry.Id)
            && entry.Id.StartsWith("game-", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizePathKey(string? path)
    {
        return path?.Trim() ?? "";
    }

    private void MigratePlainTextSecrets(AppConfig config)
    {
        if (!string.IsNullOrWhiteSpace(config.Weather.ApiKey))
        {
            _secretStore.Set("weather.apiKey", config.Weather.ApiKey);
        }

        if (!string.IsNullOrWhiteSpace(config.Calendar.IcsUrl))
        {
            _secretStore.Set("calendar.icsUrl", config.Calendar.IcsUrl);
        }

        if (!string.IsNullOrWhiteSpace(config.Hue.AppKey))
        {
            _secretStore.Set("hue.appKey", config.Hue.AppKey);
        }

        if (!string.IsNullOrWhiteSpace(config.Hue.ClientKey))
        {
            _secretStore.Set("hue.clientKey", config.Hue.ClientKey);
        }

        if (!string.IsNullOrWhiteSpace(config.UniFi.Password))
        {
            _secretStore.Set("unifi.password", config.UniFi.Password);
        }
    }

    private void ApplyProtectedSecrets(AppConfig config)
    {
        var weatherApiKey = _secretStore.Get("weather.apiKey");
        if (!string.IsNullOrWhiteSpace(weatherApiKey))
        {
            config.Weather.ApiKey = weatherApiKey;
        }

        var calendarIcsUrl = _secretStore.Get("calendar.icsUrl");
        if (!string.IsNullOrWhiteSpace(calendarIcsUrl))
        {
            config.Calendar.IcsUrl = calendarIcsUrl;
        }

        var hueAppKey = _secretStore.Get("hue.appKey");
        if (!string.IsNullOrWhiteSpace(hueAppKey))
        {
            config.Hue.AppKey = hueAppKey;
        }

        var hueClientKey = _secretStore.Get("hue.clientKey");
        if (!string.IsNullOrWhiteSpace(hueClientKey))
        {
            config.Hue.ClientKey = hueClientKey;
        }

        var unifiPassword = _secretStore.Get("unifi.password");
        if (!string.IsNullOrWhiteSpace(unifiPassword))
        {
            config.UniFi.Password = unifiPassword;
        }
    }

    private void SaveProtectedSecrets(AppConfig config)
    {
        _secretStore.Set("weather.apiKey", config.Weather.ApiKey);
        _secretStore.Set("calendar.icsUrl", config.Calendar.IcsUrl);
        _secretStore.Set("hue.appKey", config.Hue.AppKey);
        _secretStore.Set("hue.clientKey", config.Hue.ClientKey);
        _secretStore.Set("unifi.password", config.UniFi.Password);
    }

    private static void RemoveSecretsFromDiskConfig(AppConfig config)
    {
        config.Weather.ApiKey = "";
        config.Calendar.IcsUrl = "";
        config.Hue.AppKey = "";
        config.Hue.ClientKey = "";
        config.UniFi.Password = "";
    }
}
