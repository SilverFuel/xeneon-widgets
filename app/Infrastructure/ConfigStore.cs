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
    {
        _logger = logger;
        var configDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "XenonEdgeHost");
        Directory.CreateDirectory(configDirectory);

        _secretStore = new SecretStore(configDirectory, logger);
        _configPath = Path.Combine(configDirectory, "config.json");
        Current = Load();
        Save(Current);
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
            Current = Normalize(updater(Clone(Current)));
            Save(Current);
            return Clone(Current);
        }
    }

    public AppConfig ResetLocalData(bool keepPort = true)
    {
        lock (_sync)
        {
            var port = keepPort ? Current.Port : 8976;
            _secretStore.Clear();
            Current = Normalize(new AppConfig
            {
                Port = port
            });
            Save(Current);
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
            File.WriteAllText(_configPath, JsonSerializer.Serialize(diskConfig, SerializerOptions));
        }
        catch (Exception error)
        {
            _logger.Error("Failed to save config.", error);
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
        normalized.Dashboard ??= new DashboardConfig();
        normalized.Launchers ??= [];
        normalized.Weather.City = string.IsNullOrWhiteSpace(normalized.Weather.City) ? "Indianapolis" : normalized.Weather.City.Trim();
        normalized.Weather.Units = string.Equals(normalized.Weather.Units, "imperial", StringComparison.OrdinalIgnoreCase)
            ? "imperial"
            : "metric";
        normalized.Dashboard.OnboardingVersion = normalized.Dashboard.OnboardingVersion <= 0 ? 1 : normalized.Dashboard.OnboardingVersion;
        normalized.Launchers = normalized.Launchers
            .Where(entry => !string.IsNullOrWhiteSpace(entry.ExecutablePath))
            .Select(entry => new LauncherEntryConfig
            {
                Id = string.IsNullOrWhiteSpace(entry.Id) ? Guid.NewGuid().ToString("N") : entry.Id.Trim(),
                DisplayName = NormalizeLauncherDisplayName(entry.ExecutablePath, entry.DisplayName),
                IconPath = entry.IconPath?.Trim() ?? "",
                ExecutablePath = entry.ExecutablePath.Trim(),
                Arguments = entry.Arguments?.Trim() ?? ""
            })
            .ToList();
        return normalized;
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

    private void MigratePlainTextSecrets(AppConfig config)
    {
        if (!string.IsNullOrWhiteSpace(config.Weather.ApiKey))
        {
            _secretStore.Set("weather.apiKey", config.Weather.ApiKey);
        }

        if (!string.IsNullOrWhiteSpace(config.Hue.AppKey))
        {
            _secretStore.Set("hue.appKey", config.Hue.AppKey);
        }

        if (!string.IsNullOrWhiteSpace(config.Hue.ClientKey))
        {
            _secretStore.Set("hue.clientKey", config.Hue.ClientKey);
        }
    }

    private void ApplyProtectedSecrets(AppConfig config)
    {
        var weatherApiKey = _secretStore.Get("weather.apiKey");
        if (!string.IsNullOrWhiteSpace(weatherApiKey))
        {
            config.Weather.ApiKey = weatherApiKey;
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
    }

    private void SaveProtectedSecrets(AppConfig config)
    {
        if (!string.IsNullOrWhiteSpace(config.Weather.ApiKey))
        {
            _secretStore.Set("weather.apiKey", config.Weather.ApiKey);
        }

        if (!string.IsNullOrWhiteSpace(config.Hue.AppKey))
        {
            _secretStore.Set("hue.appKey", config.Hue.AppKey);
        }

        if (!string.IsNullOrWhiteSpace(config.Hue.ClientKey))
        {
            _secretStore.Set("hue.clientKey", config.Hue.ClientKey);
        }
    }

    private static void RemoveSecretsFromDiskConfig(AppConfig config)
    {
        config.Weather.ApiKey = "";
        config.Hue.AppKey = "";
        config.Hue.ClientKey = "";
    }
}
